import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { useVideoPlayer } from 'expo-video';
import { inspect, mediaHeaders, playbackPath, request, saveProgress, type Info, type Item, type Library, type Preferences, type Track } from '../lib/server';
import { matchTrack, trackKey } from '../../../../packages/core/client/library';
import { parseVtt, type Cue } from '../../../../packages/core/client/subtitles';
import { downloadPlayback } from './diskBuffer';
import { progressRecovery, recoveryScope } from '../lib/storage';

export function usePlayback({ base, data, item, initialPosition, onEnd }: { base: string; data: Library; item: Item; initialPosition?: number; onEnd: () => void }) {
  const initial = initialPosition ?? (data.progress[item.id]?.completed ? 0 : data.progress[item.id]?.position || 0);
  const pref = data.preferences.tracks?.[trackKey(item)];
  const [info, setInfo] = useState<Info | null>(null), [busy, setBusy] = useState(true), [error, setError] = useState(''), [position, setPosition] = useState(initial), [buffered, setBuffered] = useState(initial), [playing, setPlaying] = useState(false), [caption, setCaption] = useState('');
  const [audio, setAudio] = useState<number | null>(null), [subtitle, setSubtitle] = useState<number | null>(null), [delay, setDelayValue] = useState(pref?.delay || 0), [subtitleSize, setSubtitleSizeValue] = useState(pref?.size || 1), [rate, setRate] = useState(1);
  const choices = useRef({ audio, subtitle, delay, size: subtitleSize }), prefs = useRef<Preferences>(data.preferences), dataRef = useRef(data), infoRef = useRef<Info | null>(null), endRef = useRef(onEnd);
  const sourceReady = useRef(false), advanced = useRef(false), pendingStart = useRef<number | null>(null);
  const disk = useRef<{ uri: string; offset: number; audio: number | null; burn: number | null; delay: number } | null>(null), cancelDownload = useRef<(() => void) | null>(null);
  dataRef.current = data; endRef.current = onEnd;
  const at = useRef(initial), offset = useRef(0), direct = useRef(false), replacing = useRef(true), mounted = useRef(true), intent = useRef(true), generation = useRef(0), subtitleRun = useRef(0), retries = useRef(0), moved = useRef(Date.now()), lastSaved = useRef(0), forceTranscode = useRef(false), cues = useRef<Cue[]>([]), prefTimer = useRef<ReturnType<typeof setTimeout> | null>(null), bitmapTimer = useRef<ReturnType<typeof setTimeout> | null>(null), rateRef = useRef(1);
  const player = useVideoPlayer(null, p => {
    p.timeUpdateEventInterval = .25;
    p.keepScreenOnWhilePlaying = true;
    p.staysActiveInBackground = false;
    p.bufferOptions = { preferredForwardBufferDuration: 60, minBufferForPlayback: 2, maxBufferBytes: 64 * 1024 * 1024, waitsToMinimizeStalling: true };
    p.volume = Math.min(1, Number(data.preferences.volume) || .72);
  });
  const lastLocal = useRef(0);
  const persist = useCallback(async (sync = true) => {
    const duration = infoRef.current?.duration || 0;
    if (!duration || (!at.current && !dataRef.current.progress[item.id]?.position)) return;
    const entry = { ...dataRef.current.progress[item.id], position: Math.min(duration, at.current), duration, hidden: false, completed: !!dataRef.current.progress[item.id]?.completed || at.current >= duration - Math.min(10, duration * .05), updated: Date.now() };
    try { await progressRecovery.write(recoveryScope(base, dataRef.current.user), item.id, entry); }
    catch { if (mounted.current) setError('Could not save playback recovery on this device. Check available storage.'); }
    if (sync) await saveProgress(base, item.id, entry);
  }, [base, item.id]);
  const remember = useCallback(() => {
    const details = infoRef.current; if (!details) return;
    const tracks = [...details.embedded, ...details.uploaded.map(t => ({ index: 10000 + t.id, title: t.name, language: t.language, text: true }))];
    const choice = (track?: Track) => track ? { language: track.language, title: track.title, codec: track.codec, channels: track.channels } : null;
    prefs.current = { ...prefs.current, tracks: { ...prefs.current.tracks, [trackKey(item)]: { audio: choice(details.audio.find(t => t.index === choices.current.audio)), subtitle: choice(tracks.find(t => t.index === choices.current.subtitle)), off: choices.current.subtitle === null, delay: choices.current.delay, size: choices.current.size } } };
    if (prefTimer.current) clearTimeout(prefTimer.current);
    prefTimer.current = setTimeout(() => { void request(base, '/api/state', { method: 'PUT', body: { preferences: prefs.current } }).catch(() => {}); }, 400);
  }, [base, item.id]);
  const loadText = useCallback(async (index: number | null) => {
    const run = ++subtitleRun.current; cues.current = []; setCaption('');
    if (index === null || infoRef.current?.embedded.find(t => t.index === index)?.bitmap) return;
    const headers = await mediaHeaders(base), route = index >= 10000 ? `u${index - 10000}` : `e${index}`;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`${base}/api/items/${encodeURIComponent(item.id)}/subtitles/${route}`, { headers, signal: controller.signal });
      if (!response.ok) throw Error('Could not load the selected subtitles.');
      const parsed = parseVtt(await response.text());
      if (mounted.current && run === subtitleRun.current) cues.current = parsed;
    } finally { clearTimeout(timer); }
  }, [base, item.id]);
  const load = useCallback(async (position: number, shouldPlay = intent.current) => {
    const details = infoRef.current; if (!details) return;
    const run = ++generation.current; replacing.current = true; sourceReady.current = false; advanced.current = false; intent.current = shouldPlay; at.current = position; setPosition(position); setBusy(true); setError(''); moved.current = Date.now();
    try {
      const headers = await mediaHeaders(base), burn = details.embedded.find(t => t.index === choices.current.subtitle && t.bitmap)?.index ?? null;
      const compatible = forceTranscode.current || (Platform.OS === 'ios' && item.format === 'WEBM') ? { ...details, directPlay: false } : details;
      const source = playbackPath(item.id, compatible, position, choices.current.audio, burn, choices.current.delay);
      if (!mounted.current || run !== generation.current) return;
      const saved = disk.current;
      const local = saved && position >= saved.offset && saved.audio === choices.current.audio && saved.burn === burn && saved.delay === choices.current.delay ? saved : null;
      const start = local ? position - local.offset : source.start;
      offset.current = local ? local.offset : source.offset; direct.current = !!local || source.path.endsWith('/direct'); pendingStart.current = start;
      if (!local) { cancelDownload.current?.(); cancelDownload.current = null; disk.current = null; }
      await player.replaceAsync({ uri: local?.uri || base + source.path, headers: local ? undefined : headers, contentType: 'progressive', metadata: { title: item.title, artist: item.group } });
      if (!mounted.current || run !== generation.current) return;
      player.currentTime = start; player.playbackRate = rateRef.current; replacing.current = false; sourceReady.current = true;
      if (shouldPlay) player.play(); else { player.pause(); setBusy(false); }
      if (!local) cancelDownload.current = downloadPlayback(base + source.path, headers, file => {
        if (!mounted.current || run !== generation.current) return;
        const saved = { uri: file, offset: source.offset, audio: choices.current.audio, burn, delay: choices.current.delay };
        disk.current = saved; setBuffered(details.duration);
        // Switch to the finished local file at the same point; subsequent
        // playback and seeks no longer depend on the network connection.
        void (async () => {
          const atSource = Math.max(0, at.current - saved.offset), wasPlaying = intent.current && AppState.currentState === 'active';
          replacing.current = true; pendingStart.current = atSource;
          try {
            await player.replaceAsync({ uri: file, contentType: 'progressive', metadata: { title: item.title, artist: item.group } });
            if (!mounted.current || run !== generation.current) return;
            direct.current = true; player.currentTime = atSource; player.playbackRate = rateRef.current; replacing.current = false;
            if (wasPlaying) player.play();
          } catch { if (mounted.current && run === generation.current) { replacing.current = false; disk.current = null; void load(at.current, intent.current); } }
        })();
      });
    } catch (e) { if (mounted.current && run === generation.current) { replacing.current = false; setBusy(false); setError(e instanceof Error ? e.message : 'Could not play this file.'); } }
  }, [base, item.id, player]);
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
        const details = await inspect(base, item.id); if (!mounted.current) return;
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
  useEffect(() => {
    const time = player.addListener('timeUpdate', event => {
      if (replacing.current) return;
      // Native decoders emit time zero while applying the initial seek. Keep
      // the requested resume position until that seek has actually landed.
      if (pendingStart.current !== null) {
        if (Math.abs(event.currentTime - pendingStart.current) > 1) return;
        pendingStart.current = null;
      }
      const next = Math.min(infoRef.current?.duration || Infinity, offset.current + event.currentTime);
      if (sourceReady.current && event.currentTime > .1) advanced.current = true;
      if (Math.abs(next - at.current) > .05) moved.current = Date.now();
      at.current = next; setPosition(next); setBuffered(disk.current ? infoRef.current?.duration || 0 : offset.current + Math.max(0, player.bufferedPosition));
      const subtitleTime = next - choices.current.delay;
      setCaption(cues.current.filter(cue => cue.start <= subtitleTime && cue.end > subtitleTime).map(cue => cue.text).join('\n'));
      if (Date.now() - lastLocal.current > 1000) {
        lastLocal.current = Date.now(); const sync = Date.now() - lastSaved.current > 5000;
        if (sync) lastSaved.current = Date.now();
        void persist(sync).catch(() => {});
      }
    });
    const status = player.addListener('statusChange', event => {
      setBusy(event.status === 'loading');
      if (event.status === 'readyToPlay') { setError(''); moved.current = Date.now(); }
      if (event.status === 'error' && !replacing.current) recover();
    });
    const playing = player.addListener('playingChange', event => setPlaying(event.isPlaying));
    const end = player.addListener('playToEnd', () => {
      // A player constructed with a null source can emit end before inspect /
      // replaceAsync finishes. It must never navigate away or mark a movie watched.
      if (!sourceReady.current || replacing.current || !advanced.current || !infoRef.current) return;
      const duration = infoRef.current.duration;
      if (duration && at.current < duration - Math.min(10, duration * .05)) { recover(); return; }
      intent.current = false; at.current = duration || at.current;
      void persist().catch(() => {}).then(() => endRef.current());
    });
    const appState = AppState.addEventListener('change', state => { if (state !== 'active') { player.pause(); void persist().catch(() => {}); } });
    const timer = setInterval(() => { if (intent.current && (player.playing || player.status === 'loading') && Date.now() - moved.current > 25000) { moved.current = Date.now(); recover(); } }, 2000);
    return () => { time.remove(); status.remove(); playing.remove(); end.remove(); appState.remove(); clearInterval(timer); };
  }, [player, persist, recover]);
  const seek = useCallback((value: number) => {
    const duration = infoRef.current?.duration || 0; if (!duration) return;
    const target = Math.max(0, Math.min(duration - .1, value)); at.current = target; setPosition(target); moved.current = Date.now();
    if (direct.current && target >= offset.current) { pendingStart.current = target - offset.current; player.currentTime = target - offset.current; }
    else void load(target, intent.current);
    void persist().catch(() => {});
  }, [player, load, persist]);
  const toggle = () => { const shouldPlay = !player.playing; intent.current = shouldPlay; moved.current = Date.now(); if (shouldPlay) player.play(); else { player.pause(); void persist().catch(() => {}); } };
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
  const setSubtitleSize = (value: number) => { choices.current.size = value; setSubtitleSizeValue(value); remember(); };
  const changeSpeed = () => { const values = [.75, 1, 1.25, 1.5, 2], next = values[(values.indexOf(rateRef.current) + 1) % values.length]; rateRef.current = next; player.playbackRate = next; setRate(next); };
  return { player, info, busy, error, playing, position, buffered, caption, audio, subtitle, delay, subtitleSize, rate, persist, toggle, seek, chooseAudio, chooseSubtitle, setDelay, setSubtitleSize, changeSpeed, retry: () => { retries.current = 0; intent.current = true; if (infoRef.current) void load(at.current, true); else setError('Leave the player and try opening the file again.'); } };
}
