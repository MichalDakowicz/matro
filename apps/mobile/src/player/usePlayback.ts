import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { useVideoPlayer } from 'expo-video';
import { inspect, mediaHeaders, playbackPath, playbackState, request, saveProgress, stopPlayback, updateWatchOptions, type Info, type Item, type Library, type Preferences, type Progress, type Track, type TrackPreference } from '../lib/server';
import { initialTracks, subtitleTracks, titleKey, trackKey } from '../../../../packages/core/client/library';
import { isContinueDismissed, reachedCompletion, reachedPlaybackEnd } from '../../../../packages/core/client/watch-progress.js';
import { createAutoSkip } from '../../../../packages/core/client/auto-skip.js';
import { parseVtt, type Cue } from '../../../../packages/core/client/subtitles';
import { downloadPlayback } from './diskBuffer';
import { createPictureInPictureLifecycle } from './pictureInPicture';
import { loadQuality, progressRecovery, recoveryScope, saveQuality } from '../lib/storage';
import { qualityOptions } from '../../../../packages/core/client/quality.js';
import { savedTitle, type SavedMedia } from '../lib/offline';
import { describePlayback, savedPlayback } from '../../../../packages/core/client/playback-info.js';

export function usePlayback({ base, data, item, initialPosition, saved, offline = false, background = false, supportsPiP, onEnd }: { base: string; data: Library; item: Item; initialPosition?: number; saved?: SavedMedia; offline?: boolean; background?: boolean; supportsPiP?: boolean; onEnd: () => void }) {
  const initial = initialPosition ?? (data.progress[item.id]?.completed ? 0 : data.progress[item.id]?.position || 0);
  const pref = data.preferences.tracks?.[trackKey(item)];
  const [info, setInfo] = useState<Info | null>(null), [busy, setBusy] = useState(true), [error, setError] = useState(''), [position, setPosition] = useState(initial), [buffered, setBuffered] = useState(initial), [playing, setPlaying] = useState(false), [caption, setCaption] = useState('');
  const [savedCopy, setSavedCopy] = useState(saved);
  const [audio, setAudio] = useState<number | null>(null), [subtitle, setSubtitle] = useState<number | null>(null), [delay, setDelayValue] = useState(pref?.delay || 0), [audioDelay, setAudioDelayValue] = useState(pref?.audioDelay || 0), [subtitleSize, setSubtitleSizeValue] = useState(pref?.size || 1), [rate, setRate] = useState(1);
  const [session] = useState(() => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
  const choices = useRef({ audio, subtitle, delay, audioDelay, size: subtitleSize, quality: 'original' }), [quality, setQualityValue] = useState('original'), prefChanges = useRef<TrackPreference>({}), dataRef = useRef(data), infoRef = useRef<Info | null>(null), endRef = useRef(onEnd);
  const sourceReady = useRef(false), advanced = useRef(false), sampledPlayback = useRef(false), playbackStart = useRef<number | null>(null);
  const pendingStart = useRef<{ time: number; since: number } | null>(null);
  const replacement = useRef<Promise<void>>(Promise.resolve()), localSource = useRef(false);
  const offlineRef = useRef(offline), recovering = useRef(false);
  const disk = useRef<{ uri: string; offset: number; audio: number | null; burn: number | null; delay: number; audioDelay: number; quality: string; diagnostics: typeof savedPlayback } | null>(null), cancelDownload = useRef<(() => void) | null>(null);
  dataRef.current = data; endRef.current = onEnd; offlineRef.current = offline;
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
  const [diagnostics, setDiagnostics] = useState<typeof savedPlayback | null>(null);
  const markersRef = useRef(markers), seekRef = useRef<(value: number, automatic: boolean) => void>(() => {}), autoSkip = useRef<ReturnType<typeof createAutoSkip> | null>(null), backgroundRef = useRef(background);
  autoSkip.current ??= createAutoSkip();
  markersRef.current = markers; backgroundRef.current = background;
  const [settings, setSettings] = useState<Preferences>(data.preferences), settingsRef = useRef(settings);
  // Background audio keeps the decoder alive with the screen off and shows a media notification. Both need the expo-video plugin option.
  useEffect(() => { player.staysActiveInBackground = background; player.showNowPlayingNotification = background; }, [player, background]);
  useEffect(() => {
    if (offline) return;
    let active = true;
    const poll = async () => { try { const update = await request(base, '/api/segments'); if (active) { markersRef.current = update.markers[item.id] || []; setMarkers(markersRef.current); } } catch { /* Keep the last known markers offline. */ } };
    void poll();
    if (item.kind === 'show') void request(base, `/api/items/${item.id}/segments`, { method: 'POST', body: {}, accountId: dataRef.current.user.id }, 600000).catch(() => {});
    const timer = setInterval(poll, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [base, item.id, item.kind, offline]);
  const savedEntry = useRef<Progress | null>(null), confirmedEntry = useRef<Progress | null>(null);
  const persist = useCallback(async (sync = true) => {
    const { items, progress, user } = dataRef.current;
    const duration = infoRef.current?.duration || 0, previous = progress[item.id];
    if (!duration || (!at.current && !previous?.position)) return;
    const waitingForPlayback = item.kind === 'show' && !sampledPlayback.current;
    const position = Math.min(duration, at.current);
    if (waitingForPlayback && (rewatching.current || position === previous?.position)) return;
    const hidden = waitingForPlayback
      ? (previous?.hidden || isContinueDismissed(items.filter(i => i.kind === 'show' && titleKey(i) === titleKey(item)), progress) || undefined)
      : false;
    const reachedEnd = !waitingForPlayback && reachedCompletion(position, duration, markersRef.current);
    let entry: Progress = { ...previous, position, duration, hidden, completed: (!rewatching.current && !!previous?.completed) || reachedEnd, updated: Date.now() };
    if (savedEntry.current?.position === entry.position && savedEntry.current.duration === entry.duration && savedEntry.current.completed === entry.completed && savedEntry.current.hidden === hidden) entry = savedEntry.current;
    if (confirmedEntry.current === entry) return;
    savedEntry.current = entry;
    try { await progressRecovery.write(recoveryScope(base, user), item.id, entry); }
    catch { if (mounted.current) setError('Could not save playback recovery on this device. Check available storage.'); }
    if (sync && !offlineRef.current && (await saveProgress(base, item.id, entry, user))?.[item.id]) confirmedEntry.current = entry;
  }, [base, item]);
  // A download may have finished after playback was opened.
  const trySavedCopy = useCallback(async (run: number) => {
    if (savedCopy) return false;
    const copy = await savedTitle(base, dataRef.current.user, item.id).catch(() => undefined);
    if (!mounted.current || run !== generation.current) return true;
    if (!copy) return false;
    setSavedCopy(copy);
    return true;
  }, [base, item.id, savedCopy]);
  const flushPreferences = useCallback(() => {
    prefTimer.current = null;
    const changes = prefChanges.current;
    prefChanges.current = {};
    if (!offline && Object.keys(changes).length) void updateWatchOptions(base, dataRef.current.user, { preferences: { tracks: { [trackKey(item)]: changes } } }).catch(() => {});
  }, [base, item, offline]);
  const reportsActivity = !offline && !savedCopy;
  const reportsActivityRef = useRef(reportsActivity);
  reportsActivityRef.current = reportsActivity;
  const reportActivity = useCallback((playing: boolean, buffering = false) => {
    if (reportsActivityRef.current) void playbackState(base, session, playing, buffering).catch(() => {});
  }, [base, session]);
  const pictureInPicture = useMemo(() => createPictureInPictureLifecycle(
    () => { void persist().catch(() => {}); },
    () => { intent.current = false; player.pause(); reportActivity(false); },
  ), [persist, player, reportActivity]);
  const allowPiP = !!supportsPiP && !!info?.video;
  const autoPiP = allowPiP && Number(Platform.Version) >= 31 && playing && !busy && !error;
  const autoPiPRef = useRef(autoPiP); autoPiPRef.current = autoPiP;
  const remember = (patch: TrackPreference) => {
    const preferences = dataRef.current.preferences, key = trackKey(item);
    preferences.tracks = { ...preferences.tracks, [key]: { ...preferences.tracks?.[key], ...patch } };
    if (offline) return;
    Object.assign(prefChanges.current, patch);
    if (prefTimer.current) clearTimeout(prefTimer.current);
    prefTimer.current = setTimeout(flushPreferences, 400);
  };
  const choice = (track?: Track) => track ? { language: track.language, title: track.title, codec: track.codec, channels: track.channels } : null;
  const loadText = useCallback(async (index: number | null) => {
    const run = ++subtitleRun.current; cues.current = []; setCaption('');
    if (index === null || infoRef.current?.embedded.find(t => t.index === index)?.bitmap) return;
    if (savedCopy) { cues.current = parseVtt(savedCopy.text[index] || ''); return; }
    const headers = await mediaHeaders(base), route = index >= 20000 ? `f${index - 20000}` : index >= 10000 ? `u${index - 10000}` : `e${index}`;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`${base}/api/items/${encodeURIComponent(item.id)}/subtitles/${route}`, { headers, signal: controller.signal });
      if (!response.ok) throw Error('Could not load the selected subtitles.');
      const parsed = parseVtt(await response.text());
      if (mounted.current && run === subtitleRun.current) cues.current = parsed;
    } finally { clearTimeout(timer); }
  }, [base, item.id, savedCopy]);
  const load = useCallback(async (position: number, shouldPlay = intent.current) => {
    const details = infoRef.current; if (!details) return;
    playbackStart.current = null;
    const run = ++generation.current; replacing.current = true; sourceReady.current = false; advanced.current = false; intent.current = shouldPlay; at.current = position; setPosition(position); setCaption(''); setBusy(true); setError(''); moved.current = Date.now();
    player.pause();
    if (!disk.current) { cancelDownload.current?.(); cancelDownload.current = null; }
    try {
      const headers = savedCopy ? undefined : await mediaHeaders(base), burn = details.embedded.find(t => t.index === choices.current.subtitle && t.bitmap)?.index ?? null;
      const compatible = forceTranscode.current || (Platform.OS === 'ios' && item.format === 'WEBM') ? { ...details, directPlay: false } : details;
      const { audio, delay: subtitleDelay, quality, audioDelay } = choices.current;
      const streamOptions = { position, audio, burn, subtitleDelay, session, quality, audioDelay };
      const source = savedCopy ? { path: '', start: position, offset: 0 } : playbackPath(item.id, compatible, streamOptions);
      if (!mounted.current || run !== generation.current) return;
      const diskCopy = disk.current;
      const local = savedCopy ? { uri: savedCopy.uri, offset: 0, diagnostics: savedPlayback } : diskCopy && position >= diskCopy.offset && diskCopy.audio === audio && diskCopy.burn === burn && diskCopy.delay === subtitleDelay && diskCopy.audioDelay === audioDelay && diskCopy.quality === quality ? diskCopy : null;
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
        if (intent.current && (AppState.currentState === 'active' || pictureInPicture.isFloating() || backgroundRef.current)) player.play(); else { player.pause(); setBusy(false); }
      });
      replacement.current = apply;
      await apply;
      if (!mounted.current || run !== generation.current) return;
      if (!local && headers && source.path.includes('/transcode?')) cancelDownload.current = downloadPlayback(base + source.path, headers, file => {
        if (!mounted.current || run !== generation.current) return;
        const saved = { uri: file, offset: source.offset, audio, burn, delay: subtitleDelay, quality, audioDelay, diagnostics: description };
        disk.current = saved; setBuffered(details.duration);
        // Keep the current decoder running. Use the completed copy on the next
        // seek/retry instead of interrupting playback when a download finishes.
      });
    } catch (e) {
      if (mounted.current && run === generation.current && !await trySavedCopy(run)) {
        replacing.current = false; setBusy(false); setError(e instanceof Error ? e.message : 'Could not play this file.');
      }
    }
  }, [base, item.id, player, savedCopy, session, trySavedCopy, pictureInPicture]);
  const recover = useCallback(async () => {
    if (!mounted.current || !intent.current || recovering.current) return;
    recovering.current = true;
    try {
      if (await trySavedCopy(generation.current) || !intent.current) return;
      if (retries.current++ >= 2) { setBusy(false); setError(savedCopy ? 'Could not play the saved file.' : 'The media service stopped responding. Check the connection, then try again.'); return; }
      if (player.status === 'error') { forceTranscode.current = true; disk.current = null; cancelDownload.current?.(); cancelDownload.current = null; }
      await load(at.current, true);
    } finally { recovering.current = false; }
  }, [load, player, savedCopy, trySavedCopy]);
  useEffect(() => {
    mounted.current = true;
    const run = generation.current;
    void (async () => {
      try {
        const details = savedCopy?.info || await inspect(base, item.id); if (!mounted.current || run !== generation.current) return;
        const savedQuality = await loadQuality(); if (!mounted.current || run !== generation.current) return;
        choices.current.quality = savedQuality; setQualityValue(savedQuality);
        infoRef.current = details; setInfo(details);
        const preferences = dataRef.current.preferences;
        const { audio: a, subtitle: sub } = initialTracks({ audio: details.audio, subtitles: subtitleTracks(details) }, preferences.tracks?.[trackKey(item)], preferences);
        choices.current = { ...choices.current, audio: a, subtitle: sub }; setAudio(a); setSubtitle(sub);
        await loadText(sub).catch(e => { if (mounted.current) setError(e.message); });
        if (mounted.current && run === generation.current) await load(details.duration > 0 ? Math.min(at.current, Math.max(0, details.duration - .1)) : at.current, intent.current);
      } catch (e) {
        if (mounted.current && run === generation.current && !await trySavedCopy(run)) {
          setBusy(false); setError(e instanceof Error ? e.message : 'Could not read this file.');
        }
      }
    })();
    return () => {
      mounted.current = false; generation.current++; subtitleRun.current++;
      cancelDownload.current?.(); cancelDownload.current = null; disk.current = null;
      if (bitmapTimer.current) clearTimeout(bitmapTimer.current);
      if (prefTimer.current) { clearTimeout(prefTimer.current); flushPreferences(); }
      void persist().catch(() => {});
    };
  }, [base, item.id, load, loadText, persist, flushPreferences, savedCopy, trySavedCopy]);
  useEffect(() => {
    if (reportsActivity) return () => { void stopPlayback(base, session).catch(() => {}); };
  }, [base, reportsActivity, session]);
  useEffect(() => {
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
      if (settingsRef.current.autoSkip === true && sourceReady.current && player.playing) {
        const skipTo = autoSkip.current?.target(markersRef.current, next, infoRef.current?.duration || 0);
        if (skipTo != null) { seekRef.current(skipTo, true); return; }
      }
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
      if (event.status === 'loading' && intent.current && (AppState.currentState === 'active' || pictureInPicture.isFloating() || backgroundRef.current)) reportActivity(true, true);
      if (event.status === 'readyToPlay') { setError(''); moved.current = Date.now(); }
      if (event.status === 'error' && !replacing.current) recover();
    });
    const playing = player.addListener('playingChange', event => {
      if (!event.isPlaying) playbackStart.current = null;
      setPlaying(event.isPlaying);
      const active = AppState.currentState === 'active' || pictureInPicture.isFloating() || backgroundRef.current;
      const buffering = active && intent.current && !event.isPlaying && player.status === 'loading';
      reportActivity((active && event.isPlaying) || buffering, buffering);
    });
    const end = player.addListener('playToEnd', () => {
      // A player constructed with a null source can emit end before inspect /
      // replaceAsync finishes. It must never navigate away or mark a movie watched.
      if (!sourceReady.current || replacing.current || pendingStart.current !== null || !advanced.current || !infoRef.current) return;
      const duration = infoRef.current.duration;
      if (!reachedPlaybackEnd(Math.max(at.current, offset.current + player.currentTime), duration)) { recover(); return; }
      intent.current = false; at.current = duration || at.current; reportActivity(false);
      void persist().catch(() => {}).then(() => endRef.current());
    });
    const appState = AppState.addEventListener('change', state => {
      if (state !== 'active' && backgroundRef.current) void persist().catch(() => {});
      pictureInPicture.appState(state === 'active' || backgroundRef.current, autoPiPRef.current);
    });
    const timer = setInterval(() => { if ((AppState.currentState === 'active' || pictureInPicture.isFloating() || backgroundRef.current) && intent.current && (player.playing || player.status === 'loading') && Date.now() - moved.current > 25000) { moved.current = Date.now(); recover(); } }, 2000);
    const heartbeat = setInterval(() => {
      const buffering = player.status === 'loading';
      // A paused player still holds its prepared stream, so it keeps renewing the lease.
      if ((AppState.currentState === 'active' || pictureInPicture.isFloating() || backgroundRef.current) && intent.current && (player.playing || buffering)) reportActivity(true, buffering);
      else reportActivity(false);
    }, 20000);
    return () => { clearInterval(heartbeat); clearInterval(checkpoint); time.remove(); status.remove(); playing.remove(); end.remove(); appState.remove(); pictureInPicture.dispose(); clearInterval(timer); };
  }, [player, persist, recover, pictureInPicture, reportActivity]);
  const seek = useCallback((value: number, automatic = false) => {
    const duration = infoRef.current?.duration || 0; if (!duration) return;
    playbackStart.current = null;
    const target = Math.max(0, Math.min(duration - .1, value));
    if (!automatic) autoSkip.current?.seek(target);
    at.current = target; setPosition(target); setCaption(''); moved.current = Date.now();
    if (direct.current && !replacing.current && (!disk.current || localSource.current) && target >= offset.current) { pendingStart.current = { time: target - offset.current, since: Date.now() }; player.currentTime = target - offset.current; }
    else void load(target, intent.current);
    void persist().catch(() => {});
  }, [player, load, persist]);
  seekRef.current = seek;
  const setPlaybackPlaying = (shouldPlay: boolean) => { intent.current = shouldPlay; setPlaying(shouldPlay); moved.current = Date.now(); if (shouldPlay && !replacing.current) player.play(); else { player.pause(); void persist().catch(() => {}); } };
  const toggle = () => setPlaybackPlaying(replacing.current ? !intent.current : !player.playing);
  const chooseAudio = (index: number) => { choices.current.audio = index; setAudio(index); remember({ audio: choice(infoRef.current?.audio.find(t => t.index === index)) }); void load(at.current); };
  const chooseSubtitle = (index: number | null) => {
    const previousBurn = infoRef.current?.embedded.find(t => t.index === choices.current.subtitle && t.bitmap)?.index ?? null;
    choices.current.subtitle = index; setSubtitle(index);
    const sidecar = infoRef.current?.uploaded.find(t => 10000 + t.id === index);
    const file = infoRef.current?.files?.find(t => 20000 + t.id === index);
    remember({ subtitle: file ? { title: file.title, language: file.language, codec: file.codec } : sidecar ? { title: sidecar.name, language: sidecar.language } : choice(infoRef.current?.embedded.find(t => t.index === index)), off: index === null });
    const nextBurn = infoRef.current?.embedded.find(t => t.index === index && t.bitmap)?.index ?? null;
    void loadText(index).catch(e => setError(e.message));
    if (previousBurn !== nextBurn) void load(at.current);
  };
  const setDelay = (value: number) => {
    const next = Math.max(-60, Math.min(60, Math.round(value * 10) / 10)); choices.current.delay = next; setDelayValue(next); remember({ delay: next });
    if (infoRef.current?.embedded.find(t => t.index === choices.current.subtitle)?.bitmap) { if (bitmapTimer.current) clearTimeout(bitmapTimer.current); bitmapTimer.current = setTimeout(() => void load(at.current), 400); }
  };
  // The sound offset is applied by the server's transcode, so a change reloads the stream (debounced while the buttons are tapped).
  const setAudioDelay = (value: number) => {
    const next = Math.max(-10, Math.min(10, Math.round(value * 10) / 10)); choices.current.audioDelay = next; setAudioDelayValue(next); remember({ audioDelay: next });
    if (bitmapTimer.current) clearTimeout(bitmapTimer.current); bitmapTimer.current = setTimeout(() => void load(at.current), 400);
  };
  const chooseQuality = (id: string) => {
    if (id === choices.current.quality) return;
    choices.current.quality = id; setQualityValue(id); void saveQuality(id); void load(at.current);
  };
  const setSubtitleSize = (value: number) => { choices.current.size = value; setSubtitleSizeValue(value); remember({ size: value }); };
  const setSpeed = (next: number) => { rateRef.current = next; player.playbackRate = next; setRate(next); };
  const setPreference = (patch: Partial<Preferences>) => {
    settingsRef.current = { ...settingsRef.current, ...patch };
    setSettings(settingsRef.current);
    if (!offlineRef.current) void updateWatchOptions(base, dataRef.current.user, { preferences: patch }).catch(() => {});
  };
  const applyMarkers = (next: typeof markers) => { markersRef.current = next; setMarkers(next); };
  return { player, info, diagnostics, markers, applyMarkers, settings, setPreference, busy, error, playing: replacing.current && !error ? intent.current : playing, position, buffered, caption, audio, subtitle, delay, audioDelay, subtitleSize, rate, quality, qualities: savedCopy ? [] : qualityOptions(info?.video), chooseQuality, persist, toggle, setPlaybackPlaying, seek, chooseAudio, chooseSubtitle, setDelay, setAudioDelay: savedCopy ? undefined : setAudioDelay, setSubtitleSize, setSpeed, allowPiP, autoPiP, pictureInPicture, retry: () => { retries.current = 0; intent.current = true; if (infoRef.current) void load(at.current, true); else setError('Leave the player and try opening the file again.'); } };
}
