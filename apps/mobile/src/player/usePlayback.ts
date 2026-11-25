import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { useVideoPlayer } from 'expo-video';
import { inspect, mediaHeaders, playbackPath, playbackState, request, saveProgress, stopPlayback, type Info, type Item, type Library, type Preferences, type Progress, type Track } from '../lib/server';
import { matchTrack, titleKey, trackKey } from '../../../../packages/core/client/library';
import { isContinueDismissed } from '../../../../packages/core/client/watch-progress.js';
import { parseVtt, type Cue } from '../../../../packages/core/client/subtitles';
import { downloadPlayback } from './diskBuffer';
import { loadQuality, progressRecovery, recoveryScope, saveQuality } from '../lib/storage';
import { qualityOptions } from '../../../../packages/core/client/quality.js';
import type { SavedMedia } from '../lib/offline';
import { describePlayback, savedPlayback } from '../../../../packages/core/client/playback-info.js';

export function usePlayback({ base, data, item, initialPosition, saved, offline = false, onEnd }: { base: string; data: Library; item: Item; initialPosition?: number; saved?: SavedMedia; offline?: boolean; onEnd: () => void }) {
  const [diagnostics, setDiagnostics] = useState<typeof savedPlayback | null>(null);
  const initial = initialPosition ?? (data.progress[item.id]?.completed ? 0 : data.progress[item.id]?.position || 0);
  const pref = data.preferences.tracks?.[trackKey(item)];
  const [info, setInfo] = useState<Info | null>(null), [busy, setBusy] = useState(true), [error, setError] = useState(''), [position, setPosition] = useState(initial), [buffered, setBuffered] = useState(initial), [playing, setPlaying] = useState(false), [caption, setCaption] = useState('');
  const [audio, setAudio] = useState<number | null>(null), [subtitle, setSubtitle] = useState<number | null>(null), [delay, setDelayValue] = useState(pref?.delay || 0), [audioDelay, setAudioDelayValue] = useState(pref?.audioDelay || 0), [subtitleSize, setSubtitleSizeValue] = useState(pref?.size || 1), [rate, setRate] = useState(1);
  const [session] = useState(() => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
  const choices = useRef({ audio, subtitle, delay, audioDelay, size: subtitleSize, quality: 'original' }), [quality, setQualityValue] = useState('original'), prefs = useRef<Preferences>(data.preferences), dataRef = useRef(data), infoRef = useRef<Info | null>(null), endRef = useRef(onEnd);
  const sourceReady = useRef(false), advanced = useRef(false), sampledPlayback = useRef(false), playbackStart = useRef<number | null>(null);
  const pendingStart = useRef<{ time: number; since: number } | null>(null);
  const replacement = useRef<Promise<void>>(Promise.resolve()), localSource = useRef(false);
  const disk = useRef<{ uri: string; offset: number; audio: number | null; burn: number | null; delay: number; audioDelay: number; quality: string; diagnostics: typeof savedPlayback } | null>(null), cancelDownload = useRef<(() => void) | null>(null);
  dataRef.current = data; endRef.current = onEnd;
  const at = useRef(initial), offset = useRef(0), direct = useRef(false), replacing = useRef(true), mounted = useRef(true), intent = useRef(true), generation = useRef(0), subtitleRun = useRef(0), retries = useRef(0), moved = useRef(Date.now()), lastSaved = useRef(0), forceTranscode = useRef(false), cues = useRef<Cue[]>([]), prefTimer = useRef<ReturnType<typeof setTimeout> | null>(null), bitmapTimer = useRef<ReturnType<typeof setTimeout> | null>(null), rateRef = useRef(1);
  const player = useVideoPlayer(null, p => {
    p.timeUpdateEventInterval = .25;
    p.keepScreenOnWhilePlaying = true;
    p.staysActiveInBackground = false;
    p.bufferOptions = { preferredForwardBufferDuration: 60, minBufferForPlayback: 2, maxBufferBytes: 64 * 1024 * 1024, waitsToMinimizeStalling: true };
    p.volume = Math.min(1, Number(data.preferences.volume) || .72);
  });
  const lastLocal = useRef(0), rewatching = useRef(!!data.progress[item.id]?.completed);
  const [markers, setMarkers] = useState(data.markers?.[item.id] || []);
  useEffect(() => {
    if (offline) return;
    let active = true;
    const poll = async () => { try { const update = await request(base, '/api/segments'); if (active) setMarkers(update.markers[item.id] || []); } catch { /* Keep the last known markers offline. */ } };
    void poll();
    if (item.kind === 'show') void request(base, `/api/items/${item.id}/segments`, { method: 'POST', body: {} }, 600000).catch(() => {});
    const timer = setInterval(poll, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [base, item.id, item.kind, offline]);
  const savedEntry = useRef<Progress | null>(null);
  const persist = useCallback(async (sync = true) => {
    const { items, progress } = dataRef.current;
    const duration = infoRef.current?.duration || 0, previous = progress[item.id];
    if (!duration || (!at.current && !previous?.position)) return;
    const waitingForPlayback = item.kind === 'show' && !sampledPlayback.current;
    const position = Math.min(duration, at.current);
    if (waitingForPlayback && (rewatching.current || position === previous?.position)) return;
    const hidden = waitingForPlayback
      ? (previous?.hidden || isContinueDismissed(items.filter(i => i.kind === 'show' && titleKey(i) === titleKey(item)), progress) || undefined)
      : false;
    const reachedEnd = !waitingForPlayback && at.current >= duration - Math.min(10, duration * .05);
    const entry = { ...previous, position, duration, hidden, completed: (!rewatching.current && !!previous?.completed) || reachedEnd, updated: Date.now() };
    if (savedEntry.current?.position === entry.position && savedEntry.current.duration === entry.duration && savedEntry.current.completed === entry.completed && savedEntry.current.hidden === hidden) entry.updated = savedEntry.current.updated;
    savedEntry.current = entry;
    try { await progressRecovery.write(recoveryScope(base, dataRef.current.user), item.id, entry); }
    catch { if (mounted.current) setError('Could not save playback recovery on this device. Check available storage.'); }
    if (sync && !offline) await saveProgress(base, item.id, entry);
  }, [base, item, offline]);
  const remember = useCallback(() => {
    const details = infoRef.current; if (!details) return;
    const tracks = [...details.embedded, ...details.uploaded.map(t => ({ index: 10000 + t.id, title: t.name, language: t.language, text: true }))];
    const choice = (track?: Track) => track ? { language: track.language, title: track.title, codec: track.codec, channels: track.channels } : null;
    prefs.current = { ...prefs.current, tracks: { ...prefs.current.tracks, [trackKey(item)]: { audio: choice(details.audio.find(t => t.index === choices.current.audio)), subtitle: choice(tracks.find(t => t.index === choices.current.subtitle)), off: choices.current.subtitle === null, delay: choices.current.delay, audioDelay: choices.current.audioDelay, size: choices.current.size } } };
    if (prefTimer.current) clearTimeout(prefTimer.current);
    prefTimer.current = setTimeout(() => { void request(base, '/api/state', { method: 'PUT', body: { preferences: prefs.current } }).catch(() => {}); }, 400);
  }, [base, item.id]);
  const loadText = useCallback(async (index: number | null) => {
    const run = ++subtitleRun.current; cues.current = []; setCaption('');
    if (index === null || infoRef.current?.embedded.find(t => t.index === index)?.bitmap) return;
    if (saved) { cues.current = parseVtt(saved.text[index] || ''); return; }
    const headers = await mediaHeaders(base), route = index >= 10000 ? `u${index - 10000}` : `e${index}`;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`${base}/api/items/${encodeURIComponent(item.id)}/subtitles/${route}`, { headers, signal: controller.signal });
      if (!response.ok) throw Error('Could not load the selected subtitles.');
      const parsed = parseVtt(await response.text());
      if (mounted.current && run === subtitleRun.current) cues.current = parsed;
    } finally { clearTimeout(timer); }
  }, [base, item.id, saved]);
  const load = useCallback(async (position: number, shouldPlay = intent.current) => {
    const details = infoRef.current; if (!details) return;
    playbackStart.current = null;
    const run = ++generation.current; replacing.current = true; sourceReady.current = false; advanced.current = false; intent.current = shouldPlay; at.current = position; setPosition(position); setCaption(''); setBusy(true); setError(''); moved.current = Date.now();
    player.pause();
    if (!disk.current) { cancelDownload.current?.(); cancelDownload.current = null; }
    try {
      const headers = saved ? undefined : await mediaHeaders(base), burn = details.embedded.find(t => t.index === choices.current.subtitle && t.bitmap)?.index ?? null;
      const compatible = forceTranscode.current || (Platform.OS === 'ios' && item.format === 'WEBM') ? { ...details, directPlay: false } : details;
      const { audio, delay: subtitleDelay, quality, audioDelay } = choices.current;
      const streamOptions = { position, audio, burn, subtitleDelay, session, quality, audioDelay };
      const source = saved ? { path: '', start: position, offset: 0 } : playbackPath(item.id, compatible, streamOptions);
      if (!mounted.current || run !== generation.current) return;
      const diskCopy = disk.current;
      const local = saved ? { uri: saved.uri, offset: 0, diagnostics: savedPlayback } : diskCopy && position >= diskCopy.offset && diskCopy.audio === audio && diskCopy.burn === burn && diskCopy.delay === subtitleDelay && diskCopy.audioDelay === audioDelay && diskCopy.quality === quality ? diskCopy : null;
      const sourceDirect = source.path.split('?')[0].endsWith('/direct');
      const description = local?.diagnostics ?? describePlayback(details, { direct: sourceDirect, audio, burn, offset: source.offset, quality, audioDelay, toneMap: details.hdrToneMap, force: !compatible.directPlay && details.directPlay });
      const start = local ? position - local.offset : source.start;
      if (!local) { cancelDownload.current?.(); cancelDownload.current = null; disk.current = null; }
      // Native source replacements cannot be cancelled. Let an in-flight one
      // finish, then apply only the latest requested source and its timeline.
      const apply = replacement.current.catch(() => {}).then(async () => {
        if (!mounted.current || run !== generation.current) return;
        offset.current = local ? local.offset : source.offset; direct.current = !!local || sourceDirect; localSource.current = !!local;
        setDiagnostics(description);
        await player.replaceAsync({ uri: local?.uri || base + source.path, headers: local ? undefined : headers, contentType: 'progressive', metadata: { title: item.title, artist: item.group } });
        if (!mounted.current || run !== generation.current) return;
        pendingStart.current = { time: start, since: Date.now() };
        player.currentTime = start; player.playbackRate = rateRef.current; replacing.current = false; sourceReady.current = true;
        if (intent.current && AppState.currentState === 'active') player.play(); else { player.pause(); setBusy(false); }
      });
      replacement.current = apply;
      await apply;
      if (!mounted.current || run !== generation.current) return;
      if (!local && headers) cancelDownload.current = downloadPlayback(base + source.path, headers, file => {
        if (!mounted.current || run !== generation.current) return;
        const saved = { uri: file, offset: source.offset, audio, burn, delay: subtitleDelay, quality, audioDelay, diagnostics: description };
        disk.current = saved; setBuffered(details.duration);
        // Keep the current decoder running. Use the completed copy on the next
        // seek/retry instead of interrupting playback when a download finishes.
      });
    } catch (e) { if (mounted.current && run === generation.current) { replacing.current = false; setBusy(false); setError(e instanceof Error ? e.message : 'Could not play this file.'); } }
  }, [base, item.id, player, saved, session]);
  const recover = useCallback(() => {
    if (!mounted.current || !intent.current) return;
    if (retries.current++ >= 2) { setBusy(false); setError('The media service stopped responding. Check the connection, then try again.'); return; }
    if (player.status === 'error') { forceTranscode.current = true; disk.current = null; cancelDownload.current?.(); cancelDownload.current = null; }
    void load(at.current, true);
  }, [load, player]);
  useEffect(() => {
    mounted.current = true;
    void (async () => {
      try {
        const details = saved?.info || await inspect(base, item.id); if (!mounted.current) return;
        const savedQuality = await loadQuality(); if (!mounted.current) return;
        choices.current.quality = savedQuality; setQualityValue(savedQuality);
        infoRef.current = details; setInfo(details);
        const tracks = [...details.embedded, ...details.uploaded.map(t => ({ index: 10000 + t.id, title: t.name, language: t.language, text: true }))];
        const choice = prefs.current.tracks?.[trackKey(item)];
        const a = matchTrack(details.audio, choice?.audio)?.index ?? details.audio.find(t => t.default)?.index ?? details.audio[0]?.index ?? null;
        const sub = choice?.off ? null : matchTrack(tracks, choice?.subtitle)?.index ?? null;
        choices.current = { ...choices.current, audio: a, subtitle: sub }; setAudio(a); setSubtitle(sub);
        await loadText(sub).catch(e => { if (mounted.current) setError(e.message); });
        if (mounted.current) await load(at.current, true);
      } catch (e) { if (mounted.current) { setBusy(false); setError(e instanceof Error ? e.message : 'Could not read this file.'); } }
    })();
    return () => {
      mounted.current = false; generation.current++; subtitleRun.current++;
      cancelDownload.current?.(); cancelDownload.current = null; disk.current = null;
      if (bitmapTimer.current) clearTimeout(bitmapTimer.current);
      if (prefTimer.current) { clearTimeout(prefTimer.current); void request(base, '/api/state', { method: 'PUT', body: { preferences: prefs.current } }).catch(() => {}); }
      void persist().catch(() => {});
    };
  }, [base, item.id, load, loadText, persist]);
  const reportsActivity = !offline && !saved;
  useEffect(() => {
    if (reportsActivity) return () => { void stopPlayback(base, session).catch(() => {}); };
  }, [base, reportsActivity, session]);
  useEffect(() => {
    const reportActivity = (playing: boolean, buffering = false) => {
      if (reportsActivity) void playbackState(base, session, playing, buffering).catch(() => {});
    };
    const sample = (currentTime: number) => {
      if (replacing.current) return;
      // Native decoders emit time zero while applying the initial seek. Keep
      // the requested resume position until that seek has actually landed.
      if (pendingStart.current !== null) {
        const pending = pendingStart.current, elapsed = Math.max(0, Date.now() - pending.since) / 1000 * rateRef.current;
        if (currentTime < pending.time - .25 || currentTime > pending.time + .5 + elapsed) return;
        pendingStart.current = null;
      }
      const next = Math.min(infoRef.current?.duration || Infinity, offset.current + currentTime);
      if (sourceReady.current && currentTime > .1) advanced.current = true;
      if (sourceReady.current && player.playing) {
        playbackStart.current ??= currentTime;
        if (currentTime > playbackStart.current + .03) sampledPlayback.current = true;
      } else playbackStart.current = null;
      if (Math.abs(next - at.current) > .05) moved.current = Date.now();
      at.current = next; setPosition(next); setBuffered(disk.current ? infoRef.current?.duration || 0 : offset.current + Math.max(0, player.bufferedPosition));
      const subtitleTime = next - choices.current.delay;
      setCaption(cues.current.filter(cue => cue.start <= subtitleTime && cue.end > subtitleTime).map(cue => cue.text).join('\n'));
      if (Date.now() - lastLocal.current > 1000) {
        lastLocal.current = Date.now(); const sync = Date.now() - lastSaved.current > 5000;
        if (sync) lastSaved.current = Date.now();
        void persist(sync).catch(() => {});
      }
    };
    // An event can still be queued from before a seek or source replacement.
    // Read the live native clock so old payloads cannot rewind subtitles/progress.
    const time = player.addListener('timeUpdate', () => sample(player.currentTime));
    const checkpoint = setInterval(() => { if (sourceReady.current && player.playing) sample(player.currentTime); }, 1000);
    const status = player.addListener('statusChange', event => {
      setBusy(event.status === 'loading');
      if (event.status === 'loading' && intent.current && AppState.currentState === 'active') reportActivity(true, true);
      if (event.status === 'readyToPlay') { setError(''); moved.current = Date.now(); }
      if (event.status === 'error' && !replacing.current) recover();
    });
    const playing = player.addListener('playingChange', event => {
      if (!event.isPlaying) playbackStart.current = null;
      setPlaying(event.isPlaying);
      const active = AppState.currentState === 'active';
      const buffering = active && intent.current && !event.isPlaying && player.status === 'loading';
      reportActivity((active && event.isPlaying) || buffering, buffering);
    });
    const end = player.addListener('playToEnd', () => {
      // A player constructed with a null source can emit end before inspect /
      // replaceAsync finishes. It must never navigate away or mark a movie watched.
      if (!sourceReady.current || replacing.current || pendingStart.current !== null || !advanced.current || !infoRef.current) return;
      const duration = infoRef.current.duration;
      if (duration && at.current < duration - Math.min(10, duration * .05)) { recover(); return; }
      intent.current = false; at.current = duration || at.current; reportActivity(false);
      void persist().catch(() => {}).then(() => endRef.current());
    });
    const appState = AppState.addEventListener('change', state => { if (state !== 'active') { intent.current = false; player.pause(); reportActivity(false); void persist().catch(() => {}); } });
    const timer = setInterval(() => { if (AppState.currentState === 'active' && intent.current && (player.playing || player.status === 'loading') && Date.now() - moved.current > 25000) { moved.current = Date.now(); recover(); } }, 2000);
    const heartbeat = setInterval(() => {
      const buffering = player.status === 'loading';
      // A paused player still holds its prepared stream, so it keeps renewing the lease.
      if (AppState.currentState === 'active' && intent.current && (player.playing || buffering)) reportActivity(true, buffering);
      else reportActivity(false);
    }, 20000);
    return () => { clearInterval(heartbeat); clearInterval(checkpoint); time.remove(); status.remove(); playing.remove(); end.remove(); appState.remove(); clearInterval(timer); };
  }, [base, player, persist, recover, reportsActivity, session]);
  const seek = useCallback((value: number) => {
    const duration = infoRef.current?.duration || 0; if (!duration) return;
    playbackStart.current = null;
    const target = Math.max(0, Math.min(duration - .1, value)); at.current = target; setPosition(target); setCaption(''); moved.current = Date.now();
    if (direct.current && !replacing.current && (!disk.current || localSource.current) && target >= offset.current) { pendingStart.current = { time: target - offset.current, since: Date.now() }; player.currentTime = target - offset.current; }
    else void load(target, intent.current);
    void persist().catch(() => {});
  }, [player, load, persist]);
  const toggle = () => { const shouldPlay = replacing.current ? !intent.current : !player.playing; intent.current = shouldPlay; setPlaying(shouldPlay); moved.current = Date.now(); if (shouldPlay && !replacing.current) player.play(); else { player.pause(); void persist().catch(() => {}); } };
  const chooseAudio = (index: number) => { choices.current.audio = index; setAudio(index); remember(); void load(at.current); };
  const chooseSubtitle = (index: number | null) => {
    const previousBurn = infoRef.current?.embedded.find(t => t.index === choices.current.subtitle && t.bitmap)?.index ?? null;
    choices.current.subtitle = index; setSubtitle(index); remember();
    const nextBurn = infoRef.current?.embedded.find(t => t.index === index && t.bitmap)?.index ?? null;
    void loadText(index).catch(e => setError(e.message));
    if (previousBurn !== nextBurn) void load(at.current);
  };
  const setDelay = (value: number) => {
    const next = Math.max(-60, Math.min(60, Math.round(value * 10) / 10)); choices.current.delay = next; setDelayValue(next); remember();
    if (infoRef.current?.embedded.find(t => t.index === choices.current.subtitle)?.bitmap) { if (bitmapTimer.current) clearTimeout(bitmapTimer.current); bitmapTimer.current = setTimeout(() => void load(at.current), 400); }
  };
  // The sound offset is applied by the server's transcode, so a change reloads the stream (debounced while the buttons are tapped).
  const setAudioDelay = (value: number) => {
    const next = Math.max(-10, Math.min(10, Math.round(value * 10) / 10)); choices.current.audioDelay = next; setAudioDelayValue(next); remember();
    if (bitmapTimer.current) clearTimeout(bitmapTimer.current); bitmapTimer.current = setTimeout(() => void load(at.current), 400);
  };
  const chooseQuality = (id: string) => {
    if (id === choices.current.quality) return;
    choices.current.quality = id; setQualityValue(id); void saveQuality(id); void load(at.current);
  };
  const setSubtitleSize = (value: number) => { choices.current.size = value; setSubtitleSizeValue(value); remember(); };
  const changeSpeed = () => { const values = [.75, 1, 1.25, 1.5, 2], next = values[(values.indexOf(rateRef.current) + 1) % values.length]; rateRef.current = next; player.playbackRate = next; setRate(next); };
  return { player, info, diagnostics, markers, busy, error, playing: replacing.current && !error ? intent.current : playing, position, buffered, caption, audio, subtitle, delay, audioDelay, subtitleSize, rate, quality, qualities: saved ? [] : qualityOptions(info?.video), chooseQuality, persist, toggle, seek, chooseAudio, chooseSubtitle, setDelay, setAudioDelay, setSubtitleSize, changeSpeed, retry: () => { retries.current = 0; intent.current = true; if (infoRef.current) void load(at.current, true); else setError('Leave the player and try opening the file again.'); } };
}
