# Matro

A local-first media player for Electron desktop, Vite web and Expo native mobile. The interface follows the Matro UI Design canvas: no header row, a floating dock (Movies, Shows, Search, Folders — Music appears when you have audio), and the Matro wordmark with its mark in the top-right corner. With no dock item selected you are on the landing page: Continue Watching first, then an endless poster reel you browse by scrolling sideways, dragging or with ← / →, then your shelves. Titles open a full title page; playback uses flat controls over the video with a thin full-width seeker and 5-second skips.

## Workspace and running

Matro is an npm-workspaces monorepo with one root lockfile. Install from this folder with Node.js 22.13 or newer:

```sh
npm install
npm start                         # Standalone Electron desktop
npm run start:receiver -- https://matro.example.com  # Server receiver
npm run build:web                 # Vite production web build
npm run start:server              # Serves the web build and authenticated API on :8484
npm run dev:web                   # Vite development server; proxies /api to :8484
npm run start:mobile              # Expo native app
npm run android --workspace @matro/mobile
```

- `packages/core/`: application services, desktop runtime, server, shared playback preparation and portable native API client.
- `packages/browser-ui/`: browser components, styles and assets shared by Electron and Vite through imports.
- `apps/desktop/`: Electron entry, isolated preload bridge and desktop HTML.
- `apps/web/`: Vite entry and browser HTTP/authentication/profile adapters.
- `apps/mobile/`: Expo React Native UI using expo-video, with no WebView dependency.
- `apps/server/`: server commands, container configuration and integration tests.

There is no generated vendor copy or UI synchronization script. Rebuild Vite after changing shared browser UI before starting the production server. For server setup, run `npm run setup --workspace @matro/server`. See [server instructions](apps/server/README.md) and [native app instructions](apps/mobile/README.md).

```sh
npm test                          # Core, real media, cache and download tests
npm run test:server               # API/authentication and media integration
npm test --workspace @matro/mobile
npm run typecheck:mobile
npm run test:e2e                  # Electron UI regression tests
npm run pack                     # Unpacked desktop app in dist/win-unpacked
npm run dist                     # Windows installer
```

Tests generate isolated media and profiles under `.test-media/` and temporary directories. Download tests use mock clients and never download real releases. Set `MATRO_METADATA=off` to prevent metadata requests during local testing.

### Posters and metadata (TMDB, optional)

Matro can fill in posters, backdrops, director/creator, year, genres, overview, episode names and the TMDb rating from [TMDB](https://www.themoviedb.org/). It is off unless you provide credentials. Put them in a `.env` file — in the project folder for development, or in the user-data folder for a packaged app:

```sh
TMDB_ACCESS_TOKEN=your-read-access-token   # or TMDB_API_KEY=...; VITE_-prefixed names also work
```

`.env` is git-ignored and excluded from packaged installers. For a packaged app, keep your own credentials in `.env` inside the user-data folder; development can use the project-local file. Only the main process reads it; the renderer never sees the token. When enabled, Matro sends cleaned title names (and a release year when the file name has one) to TMDB, downloads artwork once into `artwork/` in the user-data folder, and caches results in `metadata.json`. Titles with no match keep generated covers and are checked again after a week. On a title page, **Fix match** (or **Find on TMDB** for unmatched titles) searches TMDB so you can pick the right entry, or drop the match and keep the file name; manual choices are never overwritten by automatic matching. The TMDB credit, local-library status and background scan progress live in the panel behind the **?** button in the bottom-right corner. Set `MATRO_METADATA=off` to disable lookups even when a key is present. IMDb and community ratings are not shown: there is no source for them yet.

## What works

- Recursive folder import and rescan, file import, drag/drop, search, and shows/movies/audio filters. Title folders with one video become movies; multiple videos become shows. Season folders stay under their parent show. Episode numbers come from `S01E02`, `1x02`, or chapter/episode filenames, with natural filename order as a fallback.
- Playback through bundled FFmpeg, including MKV, MP4, AVI, MOV, WebM, MPEG/TS and common audio inputs supported by that build.
- Seeking with hover thumbnails and precise timestamps, 5-second skip buttons and arrow keys, pause, volume/mute with a percentage readout, speed, fullscreen, chapters, queue (a drawer over the video), autoplay, and resume saved between launches. Skip markers show as faint ranges on the seeker. Fullscreen expands video to the display, removes window chrome, and hides the queue until requested; Esc exits fullscreen.
- Embedded text subtitles and external SRT/VTT/ASS/SSA converted to WebVTT, plus embedded bitmap subtitles (PGS, DVD/VobSub, DVB, XSUB) composited into playback. Subtitle delay works for text and bitmap tracks; text size is adjustable, while bitmaps retain their original appearance.
- Audio and subtitle track labels lead with readable language names, with track titles beside them and codec/channel details below.
- Audio language, subtitle language/Off, subtitle delay, and size carry between episodes and launches per show. Tracks match by language and title rather than stream index. External subtitle files remain specific to the current episode.
- Continue watching keeps one card per show, saves progress from the first seconds, and advances to the next unfinished episode. Remove dismisses the whole show until you watch it again, preserving progress and completion. Mark complete is available in details, the queue, and playback; rewatching never clears completion. Use Mark incomplete to clear it explicitly. Seasons have separate headings in episode details and the player sidebar.
- Skip intro/outro/recap buttons use saved segment markers. Open Audio and subtitles to mark a start, seek to the end, and save. Shows also compare local perceptual frame fingerprints against other episodes in the same season in the background. Matching tolerates small visual changes, shifted timing, and isolated edits; early material repeated from story scenes is classified as recap. Review, remove, or replace detected markers there. Compare season again refreshes results after adding episodes. Fingerprints are cached locally; first scans can take several minutes on long seasons.
- Library state stored in Electron's user-data directory (`%APPDATA%/Matro` or `%APPDATA%/matro`, depending on development/packaged app naming).

## Current limits

Playback writes a local recovery checkpoint before network saves: desktop/web on playback updates and native mobile about once a second, plus pauses and seeks. After a crash or sudden exit, reopening merges the newest local position into Continue Watching and resumes from it, then syncs it back to the server. Checkpoints are separated by server and account; a newer server position wins over an older local copy. Recovery uses the last written checkpoint rather than relying on a closing event.

Desktop/web playback keeps fetching through to the end while you watch or pause, storing the stream in temporary IndexedDB blocks. Decoder memory can stop filling without stopping the download. The timeline shows the buffered portion. Browsers without MediaSource or available disk storage fall back to progressive playback. Native playback downloads a temporary file alongside the ordinary stream and switches to that local file at the same position when complete, so subsequent playback no longer needs the network. Temporary client buffers are removed when leaving playback or changing the stream; this may transfer the native movie twice. Starting or seeking still uses the short initial preparation buffer instead of waiting for the entire movie.

Native playback and browser fallback can play compatible local MP4/WebM directly with byte-range seeking. The desktop/browser full-buffer path uses fragmented MP4 so it can keep downloading independently of the decoder. Compatible H.264 is remuxed without re-encoding when starting at the beginning. Other codecs, exact seeks into transcoded streams, and bitmap subtitle composition use an encoder selected by a real device probe: NVIDIA NVENC, Intel QSV, AMD AMF or Apple VideoToolbox when available, with a two-thread software fallback. GPU encoding requires an FFmpeg build that includes the encoder and a working device/driver; When a working hardware encoder is selected, compatible streams also request automatic hardware decoding; bitmap composition stays on CPU. If that path fails, preparation falls back to software.

Shared playback preparation writes fragmented MP4 ahead to disk independently of the player. Prepared streams wait for eight seconds of media (or the end of a shorter clip) before sending the first fragment, giving playback a cushion against brief disk and network contention during downloads. It keeps preparing the current movie through pauses and disconnected clients; completed outputs survive app restarts and support byte ranges. A seek replaces obsolete work, shared viewers reuse preparation, and concurrent jobs are capped. Outputs are keyed by source size/mtime, position and track settings. Completed cache files are evicted when over the target (default 32 GiB); active outputs may temporarily exceed the total target, and a single output larger than the target fails with an explicit error. Set `MATRO_PLAYBACK_CACHE_GB` to change the target. This prepares the rest of the selected movie during playback; it does not pre-render the whole library.

A 45-second preparation watchdog terminates hung FFmpeg processes. Browser and native playback attempt two recoveries from the current position after errors or prolonged buffering, then show a retry action. `MATRO_VIDEO_ENCODER=software` disables hardware encoding; individual encoder names such as `h264_nvenc` select a preferred device with software fallback. The server supports `MATRO_FFMPEG`, `MATRO_FFPROBE` and `MATRO_MAX_TRANSCODES` (default 4); desktop preparation allows two concurrent jobs.

Transcoded audio is stereo AAC. HDR/color fidelity, audio passthrough, surround output and advanced ASS styling are not preserved during transcoding. Damaged, encrypted and DRM files are unsupported.
