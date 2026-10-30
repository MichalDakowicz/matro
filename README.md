# Matro

A local-first Electron media player. The interface follows the Matro UI Design canvas: no header row, a floating dock (Movies, Shows, Search, Folders — Music appears when you have audio), and the Matro wordmark with its mark in the top-right corner. With no dock item selected you are on the landing page: Continue Watching first, then an endless poster reel you browse by scrolling sideways, dragging or with ← / →, then your shelves. Titles open a full title page; playback uses flat controls over the video with a thin full-width seeker and 5-second skips.

## Run

Requires Node.js 22.12 or newer and npm. Windows is the initial development target.

```sh
npm install
npx install-electron --no
npm start
```

Electron, FFmpeg, and FFprobe are downloaded during installation; no separate codec installation is required. No server or account is needed. Add a folder, open files, or drop media files into the window. Mounted NAS/network folders work as ordinary folders.

```sh
npm test          # Scanner, metadata, and real FFmpeg stream checks
npm run test:e2e # Real Electron UI and playback checks
npm run pack     # Unpacked desktop application in dist/
npm run dist     # Windows NSIS installer
```

The UI tests generate their own small MKV/audio/subtitle fixtures and an isolated profile under `.test-media/`; they do not modify your library. `test-results/` contains screenshots after UI tests. No separate Playwright browser download is needed: tests launch Electron. UI tests set `MATRO_METADATA=off`, so they never contact TMDB.

### Posters and metadata (TMDB, optional)

Matro can fill in posters, backdrops, director/creator, year, genres, overview, episode names and the TMDb rating from [TMDB](https://www.themoviedb.org/). It is off unless you provide credentials. Put them in a `.env` file — in the project folder for development, or in the user-data folder for a packaged app:

```sh
TMDB_ACCESS_TOKEN=your-read-access-token   # or TMDB_API_KEY=...; VITE_-prefixed names also work
```

`.env` is git-ignored, so it is never committed, but `npm run dist` packs the one in the project folder into the installer so a packaged app works without setup. Anyone with that installer can read the token, so only use a free, low-privilege key, and build releases for others without a `.env` present. Only the main process reads it; the renderer never sees the token. When enabled, Matro sends cleaned title names (and a release year when the file name has one) to TMDB, downloads artwork once into `artwork/` in the user-data folder, and caches results in `metadata.json`. Titles with no match keep generated covers and are checked again after a week. On a title page, **Fix match** (or **Find on TMDB** for unmatched titles) searches TMDB so you can pick the right entry, or drop the match and keep the file name; manual choices are never overwritten by automatic matching. The TMDB credit, local-library status and background scan progress live in the panel behind the **?** button in the bottom-right corner. Set `MATRO_METADATA=off` to disable lookups even when a key is present. IMDb and community ratings are not shown: there is no source for them yet.

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

Playback currently transcodes to H.264/AAC fragmented MP4 inside the app, using software encoding and stereo audio. High-resolution files can be CPU intensive. Seeking outside buffered media, changing audio, or changing bitmap subtitles/delay restarts the stream briefly. Original HDR/color fidelity, audio passthrough, surround output, and advanced ASS styling are not preserved. Bitmap support currently covers embedded tracks; external bitmap sidecars are not supported. Damaged or encrypted/DRM files are not supported. Without TMDB credentials (or for unmatched files) covers are generated from the title: typography and colour, not fetched posters.

Automatic segment detection starts when the app opens, even with no video playing. It prepares episodes one by one: the current show first, then Continue watching shows (resume episode and upcoming episodes first), then the rest of the library. The library footer shows background progress. Results, completed scan records, and fingerprints persist between launches. Adding or changing season files schedules fresh comparisons; unavailable episodes retry later instead of blocking other shows.

A quick pass checks the first five and last four minutes of episodes longer than fifteen minutes, comparing up to two nearby episodes. Shorter episodes are scanned in full. Once all episodes have had a quick pass, full scans check for later openings and recap footage from story scenes. One-second perceptual samples tolerate small visual changes and timing differences. Comparisons run in a worker thread; completed minute-sized decoding chunks are reused across interruptions, playback changes, and app restarts.

The scanner keeps working while video plays. It uses a single decoder thread, low OS process priority, and a capped input rate during playback. It slows further if the video buffers, then speeds up when playback stabilizes; when nothing is playing it uses two decoder threads without the read-rate cap. Changes to resource limits resume from cached chunks. This reduces competition with playback, but first scans still take time and high-resolution software playback remains CPU intensive.

Boundaries are approximate; heavily changed sequences, audio-only repeats, or very short recaps may need manual marking. Detection offers a skip button and never skips without your click. Outro fragments separated by up to ten seconds are joined; longer breaks stay separate. Removed automatic markers stay dismissed during background scans; Compare season again explicitly refreshes them. Manual markers take precedence over automatic matches. Skip segment settings shows per-episode scan progress; matches become usable after each comparison without waiting for the entire season.

Starting a series replaces an old mixed queue with that show's episodes in season/episode order. Next, Previous, and autoplay stay inside that series and stop at its end. Removing an episode from the active queue keeps it removed while stepping through the remaining episodes; starting the series again from the library restores its full episode list.

On Windows, a native Electron `0x80000003` startup crash can come from runtime folder ACLs. If stderr explicitly reports `install_dir_access.cc` and missing `ALL APPLICATION PACKAGES` access, grant read/execute to the reported runtime folder with `icacls "node_modules\electron\dist" /grant "*S-1-15-2-1:(OI)(CI)(RX)"`. Codex's restricted process sandbox may still prevent desktop launches; run desktop tests in an ordinary terminal or with approved execution outside that sandbox. Keep Electron's renderer sandbox enabled.

### SSH media folders

Choose **Connect SSH** on the welcome page or under **Folders**. Enter the server,
username, SSH port (normally 22), and an absolute media folder such as `/mnt/media`.
An optional private-key path selects a specific key; otherwise Matro uses your
OpenSSH keys or agent. First verify key login in a terminal:

```sh
ssh michu@192.168.100.6
```

Accept the host key in that terminal after checking it. Matro requires a known host
and noninteractive key authentication; it does not store or prompt for passwords.
Windows OpenSSH must be installed on the PC and Python 3 on the Linux server.
Encrypted keys work when loaded into the SSH agent.

Matro scans and reads the configured directory over SSH. Videos stream in chunks
with byte-range seeking; movies are not downloaded in full. FFmpeg playback,
thumbnails, embedded and adjacent text subtitles, and background segment detection
continue to run locally. Loading a local SRT, VTT, ASS, or SSA subtitle saves a copy
beside the video on the server (up to 16 MiB). Existing files are never overwritten;
a numbered filename is chosen when needed. Uploads are staged in the destination
directory and published only when complete. If the server is offline or its folder
is read-only, the subtitle still works for the current session and Matro shows a
save warning. No movie files are changed. A temporary Python helper runs inside the
SSH session, with no remote listening port or installed service. It exits when
Matro disconnects. Progress, subtitle choices, delay, appearance, and other player
preferences remain saved on this PC; these are not synchronized through the server.

Connection settings are saved with your library and reconnect on demand after
restart. If the server goes offline, cached entries stay in the library; use
**Rescan** or retry playback after reconnecting. Remove an SSH folder under
**Folders** to close its connection without deleting server files. Importing an old
local library under the new SSH source creates new path-based item IDs; previous
local watch progress is not automatically migrated.

Remote catalog browsing outside the configured folder, web/mobile clients, and sync remain planned.

See [OVERVIEW.md](OVERVIEW.md) for the product direction, architecture, decisions, and roadmap. Original source: MIT; bundled media binaries have separate licenses described in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
