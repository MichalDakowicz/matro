# Matro — product and implementation overview

## Direction

Matro is an open-source media library and player for people who own their media. The long-term system stores movies and shows on a self-hosted server and lets desktop, web, and mobile apps connect to it easily. The desktop app also stands on its own as a modern, comfortable alternative to VLC: open a file and watch it without setting up infrastructure or signing in.

**Current priority: the standalone desktop player.** The server is not set up yet, so no desktop feature depends on it. Server, web, and mobile work follows after local playback is dependable.

## Design foundation

- `design/Library.dc.html`: padded dark surfaces, a rounded sidebar, library search, continue-watching hero, title cards, folders, and an episode drawer.
- `design/Main.dc.html`: embedded video, restrained warm-white controls, track/subtitle panel, seek bar, and a separate queue with autoplay.
- `design/Logos.dc.html`: the supplied play-and-seek-bar vector mark, used in the title bar and Windows app/installer icons. The sidebar omits repeated branding, and the title bar uses a medium-weight Matro label without a Desktop suffix. `assets/icon.svg` is the app-icon source; `npm run icons` regenerates PNG and multi-resolution ICO assets through Electron.

The implementation carries those layouts and colors into a responsive desktop window. The initial library is honestly empty; fictional films from the design previews are not imported. A CSS landscape introduces the empty library. Local titles use generated typography covers until artwork support is added. The desktop window has native minimize, maximize, close, and fullscreen actions.

## Current desktop features

### Library

Users can add local or mounted network folders, open multiple files, or drop files into the window. Folder scans recurse without following directory symlinks. Rescan updates available folders and reports unavailable roots without erasing their catalog. Removing a folder removes its entries from Matro only; it never deletes media on disk.

Folder scans preserve title directories: one video in a title folder becomes a movie; multiple videos become a show. Collection roots such as Media, Shows, and Movies are traversed into individual title directories. Nested S01/S02 or Season 1 folders remain seasons of the parent title. Folder identity keeps equally named shows in different directories separate. Season and episode numbers come from S01E02/1x02 filenames, season directories, or chapter/episode numbers; natural filename order provides fallback numbering. Audio files remain under Music and do not affect video counts. Individually opened files retain filename-based classification. Search matches show and file titles. The drawer exposes file location, playback, and queue actions. Existing folder libraries are rescanned automatically once when upgrading to this grouping version; file IDs, watch progress, and queues remain stable.

### Playback

FFprobe reads real streams, duration, and chapters. FFmpeg decodes the selected input and serves H.264 video/AAC stereo audio as fragmented MP4 over an ephemeral loopback HTTP port. Electron's video element displays that stream within the player UI. Seeking inside buffered media uses the video element; seeking elsewhere starts FFmpeg at the requested position. Audio selection also restarts at the current position.

Recognized import extensions include MKV, MP4/M4V, AVI, MOV, WebM, FLV, WMV, MPG/MPEG, TS/MTS/M2TS, VOB, OGV, 3GP, MP3, FLAC, WAV, AAC, M4A, OGG, Opus, WMA, AIFF, and ALAC. Actual decoding depends on the bundled FFmpeg build and the file's codec, not just its extension. The file dialog also offers an all-files view, though imports currently use the extension allowlist.

Controls include pause, seek, 10-second jumps, volume/mute, playback speed, fullscreen, previous/next queue entry, and chapter jumps. Progress is persisted periodically and on pause/navigation. Completed titles restart from the beginning. Queue state, autoplay, and volume survive restarts.

Hovering the seek bar displays a source-frame thumbnail and a target timestamp to tenths of a second. Thumbnail requests are debounced, obsolete decoder work is cancelled, and up to 100 frames are cached in memory in one-second buckets. Audio-only items show the timestamp without a thumbnail. Preview failure leaves seeking available.

Fullscreen removes the title bar, window padding, and rounded player frame, expanding the video stage to the entire display while preserving the source aspect ratio. The queue is hidden on entry and can be opened as an overlay. Controls hide while playing when the pointer and keyboard focus are idle. Escape exits fullscreen and restores the windowed layout.

### Subtitles and audio

Audio tracks are read from the media file. Track rows place the full language name first (Japanese, English, Polish, etc.), followed by the track title, with codec, channels, and default status below. The same language-first labeling is used for subtitles. Text subtitle streams (including SRT, ASS/SSA, WebVTT, and MOV text) are converted to WebVTT. Users can also load external SRT/VTT/ASS/SSA files. Subtitle timing is adjusted relative to the original file timeline after seeks; text size and subtitle delay can be changed in the panel.

Embedded bitmap tracks (PGS, DVD/VobSub, DVB, XSUB) use FFmpeg's bitmap-to-video overlay path, composited into the selected playback stream. Selecting a bitmap, turning it off, switching back to text, or changing bitmap delay reloads playback at the current position while preserving play/pause intent. Bitmap size/styling is preserved and its text-size controls are disabled. External bitmap sidecar files are not supported yet. PGS and DVD rendering, clearing, seeking into active captions, and positive/negative delay are covered by generated media tests; a DVD bitmap clip from the local Akira file was also decoded during development. ASS text survives conversion, but advanced styling and animation do not. Audio output currently downmixes to stereo. Track language choices are not yet retained across different files; the next file selects its default audio track and disables subtitles.

### Keyboard

| Shortcut | Action |
| --- | --- |
| Space | Play / pause |
| Left / right | Seek 5 seconds (on the landing reel: previous / next title) |
| Up / down | Adjust volume |
| M | Mute / unmute |
| F | Toggle fullscreen |
| Escape | Exit fullscreen, otherwise close details/tracks or return to library |
| Ctrl/Cmd + O | Open media files |
| Ctrl/Cmd + K | Open Search |

## Architecture

```text
src/                       Renderer: library, player, queue, controls
  index.html               Local shell and content security policy
  styles.css               Design system and adaptive layouts
  app.js                   UI state and player interactions
electron/
  main.cjs                 Electron lifecycle, dialogs, IPC, persistence
  preload.cjs              Narrow context-isolated renderer API
  media.cjs                File scanning, filename parsing, FFprobe helpers
  stream.cjs               Token-scoped loopback FFmpeg stream service
  previews.cjs             Cancellable source-frame extraction and memory cache
tests/                     Real media and Electron integration tests
design/                    Original design references
```

The renderer has no Node.js integration and runs sandboxed with context isolation. Only packaged UI files are served through `matro://app`. New windows, navigation, and permission requests are denied. Main-process IPC checks its sender and frame. Playback and embedded subtitle requests reference catalog IDs instead of arbitrary renderer-provided input paths. The stream service binds only to `127.0.0.1` and uses random session tokens. FFmpeg subprocesses use argument arrays, not shell command interpolation. Media decoding is limited to local-file protocols; server URLs are not accepted in this milestone.

Library state lives in `library.json` in Electron's user-data directory and is written through a temporary file and rename. Media files are left in place. No telemetry, accounts, external font requests, or server calls are included. The one optional network service is TMDB metadata (`electron/metadata.cjs`): it runs only when TMDB credentials are configured in a local `.env` or the environment, lives entirely in the main process, sends cleaned title names, and serves downloaded artwork to the renderer through `matro://app/artwork/` so the renderer's content security policy stays `'self'`-only.

## Tradeoffs and known gaps

The FFmpeg bridge makes broad decoding practical without a native addon or an independently installed player. It is a compatibility-first first implementation, not a final VLC-equivalent playback engine. Software transcoding costs CPU and introduces startup/seek latency; it does not preserve HDR, original bitstream audio, multichannel output, or every codec feature. Fast seeks depend on the source's index and keyframes. Protected media is outside scope.

Before positioning Matro as a high-end 4K desktop player, evaluate an embedded libmpv/libVLC engine or another maintained native render integration. Priorities are direct decode, hardware acceleration, color management/HDR, surround/passthrough, richer subtitle rendering, and reliable audio/subtitle preference matching. The UI/IPC boundary is deliberately separate from the current streaming backend to make that replacement possible.

Other gaps: file watching, background scan progress/cancel, real artwork/metadata, a database for very large collections, remembered track choices, duplicate-show disambiguation, OS file associations, accessibility review beyond implemented labels/focus states, code signing, and automated update delivery. Windows is the verified initial target; macOS/Linux installers and platform behavior need their own validation.

## Roadmap

1. **Desktop foundation (current):** real local playback, design-based library/player, queue, resume, language-first tracks, text/bitmap subtitles, hover previews, fullscreen playback, and packaging configuration.
2. **Desktop quality:** validate against a real-world codec corpus; improve native decode/performance, subtitle fidelity, fullscreen behavior, artwork, file associations, accessibility, and release packaging.
3. **Server contract:** define authenticated catalog, direct-play/transcode, range/HLS streaming, subtitles, capabilities, and watch-progress APIs. Choose whether to build a Matro server or adapt a mature self-hosted media protocol before implementing connection UX.
4. **Desktop server linking:** URL plus credentials/token, connection test, useful connection errors, server discovery if justified, local/server source switching, and resilient reconnects. Mounted folders already work without this API.
5. **Web and mobile:** reuse product language and interaction models; implement platform playback adapters and sync against the server contract. Electron-specific APIs stay out of shared catalog models.

No hosting provider, server authentication scheme, sync protocol, or mobile framework is committed yet. Do not add a fake server connection screen before there is a real, testable server contract.

## Running, testing, and releases

Use the commands in `README.md`. Unit/integration tests generate short real files, exercise filename parsing/scans, inspect actual audio/subtitle streams, and decode the loopback output. Electron tests exercise the empty library, imports through the application boundary, playback, seeks, queue, tracks, and progress persistence in an isolated profile.

The pack command creates a local unpacked app. The dist command creates an unsigned Windows development installer. Public releases still need exact binary/license/source compliance checks (especially GPL-enabled FFmpeg builds), signing, an icon, platform testing, and an update strategy. See `THIRD_PARTY_NOTICES.md`.
