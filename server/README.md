# Matro server

A self-hosted Matro: open one URL, sign in, and watch what the server owns. One **head
account** adds the films and shows; every other account can watch, keeps its own progress and
audio/subtitle choices, and can add subtitles to any title.

No database server and no build step. It needs Node 22.13 or newer (SQLite is built in) and
FFmpeg (bundled through `ffmpeg-static` unless you point to your own).

```bash
cd server
npm install
npm start          # http://localhost:8484
```

`npm run dev` starts it on throwaway data with a few generated sample videos, to try the UI.

## First run

The head account is created from the command line on the machine that runs the server, never from
the web page, so nobody who finds the address first can claim it. Until it exists the web page only
shows this instruction.

```bash
npm run setup                  # or: node src/cli.js setup
docker compose exec matro node src/cli.js setup     # in Docker
```

It asks for a username and a password (hidden, twice), creates the head account, registers the
media folder (plus any `MATRO_LIBRARY` folders and `--library PATH` options) and scans them. For
scripts set `MATRO_PASSWORD` or pass `--password-stdin` and `--username`. There is only one head
account; `node src/cli.js passwd USERNAME` sets a new password for any account (the way back in if
the head password is lost) and signs that account out everywhere.

From then on it is all in the browser:

- **Folders** (the dock's Folders page) – folders on the server machine, or files sent from your
  browser. One video in a title folder is a film, several are a show; `S01`/`Season 1` folders stay seasons.
  Rescans run every 30 minutes and on demand. Removing a folder only forgets it; files are never touched.
- **People** (your profile page) – new accounts are made by the person joining: press **Create invite code**
  and send them the code (or the link next to it). It works once, expires after 7 days, and is shown only
  at that moment (the server keeps just a hash). They open the sign-in page, choose **Have an invite
  code?**, enter it and pick their own username and password, so you never see or set their password.
  You can revoke unused codes, reset a viewer's password or remove a viewer. `node src/cli.js invite`
  makes a code from the server's terminal too. Viewers cannot add or remove titles or see server paths.

## The interface

The web app is **the desktop app's own renderer** (`../src/app.js` and `styles.css`), not a lookalike.
`scripts/sync-ui.js` copies those files into `public/` (`npm start` does it for you), and
`public/web/adapter.js` implements the `window.matro` object Electron would provide, turning each
call into a request to this server. When the desktop UI changes, run `npm run sync-ui` (or restart)
and the web app follows. Two things are added around it: a sign-in page, and a profile page (click your
avatar next to the Matro logo).

Desktop-only features are hidden: SSH sources, preludes and
intro/outro skip detection.

## What viewers get

- Their own progress, queue, continue-watching, watched marks, and the audio/subtitle language, delay
  and subtitle style the player remembers for each show or film. All stored per account.
- Subtitles from inside the file (SRT, ASS, WebVTT, MOV text; image tracks such as PGS are burned
  into the picture), plus subtitles any viewer uploads.
- Seek-bar hover previews and continue-watching thumbnails, rendered by the server from the video.

### Adding and labelling subtitles

In the player open **Audio & subtitles → Load subtitle file…**, choose an SRT, VTT, ASS or SSA file,
then set:

| Field    | Meaning |
| -------- | ------- |
| Name     | What everyone sees, e.g. "English (fan-timed)" |
| Language | Shown first in the track list |
| Type     | Full, forced only, or SDH / captions |

Uploads are converted to WebVTT once, stored in the database and shared with everyone who can open
that title. Non-UTF-8 files are decoded with the legacy code page of the chosen language (for example
Windows-1250 for Polish). The uploader and the head account can rename or delete a track from the
profile page; nobody else can.

## Playback

MP4/M4V/MOV/WebM with H.264/VP9 video and AAC/MP3/Opus first audio plays **directly** with range
requests. Everything else (MKV, HEVC, AVI, a different dub, image subtitles) is transcoded by
FFmpeg to H.264/AAC fragmented MP4 from the requested position. Each account runs one transcode at
a time and the server runs at most `MATRO_MAX_TRANSCODES` (default 4). Software transcoding costs
CPU; pre-converting a library to MP4 with AAC audio avoids it.

## Configuration

| Variable | Default | |
| -------- | ------- | - |
| `PORT`, `HOST` | `8484`, `0.0.0.0` | Listen address |
| `MATRO_DATA` | `server/data` | Database and caches |
| `MATRO_MEDIA` | `<data>/media` | Upload target, registered as a library folder |
| `MATRO_LIBRARY` | none | Comma-separated folders added to the library at start |
| `MATRO_TRUST_PROXY` | off | Trust `X-Forwarded-For`/`-Proto` from a reverse proxy: login throttling uses the real client address and the session cookie is marked `Secure` on HTTPS requests (and only those, so the plain-HTTP LAN address keeps working) |
| `MATRO_MAX_TRANSCODES` | `4` | Concurrent transcodes |
| `MATRO_MAX_UPLOAD_GB` | `64` | Per-file upload limit |
| `MATRO_FFMPEG`, `MATRO_FFPROBE` | bundled | Use your own binaries |

### Putting it on the internet

Run it behind an HTTPS reverse proxy (Caddy, nginx, a Cloudflare tunnel) and set
`MATRO_TRUST_PROXY=1`. The server itself speaks plain HTTP. Disable
proxy buffering for `/api/items/*/transcode` and raise the body limit for `/api/admin/upload`.

A Docker image is provided: `docker compose up -d` (edit the media mount first).

## Security notes

- Passwords are scrypt-hashed. Sessions are random tokens, stored hashed, valid 30 days, and end
  when a password is changed or reset.
- Every write needs an `x-matro` header and a same-origin `Origin`; the cookie is `HttpOnly` and
  `SameSite=Lax`. Five wrong passwords lock that address and name for a minute, doubling after.
- Viewers never see file paths; media is addressed by opaque ids and only through signed-in
  routes. The page is served with a strict Content-Security-Policy (no inline script, no
  third-party hosts, fonts bundled).
- The head account can read any folder on the machine through the folder picker. Run the server as
  a user that can only read what you intend to share.

## Tests

```bash
npm test
```

Generates real media with FFmpeg and exercises setup, roles, catalog, ranges, transcoding,
embedded and uploaded subtitles (including legacy encodings), per-user state, uploads, session
revocation and throttling.

## Not here yet

Artwork and metadata from TMDB, HLS/adaptive bitrate, hardware transcoding, a native mobile player (the Android receiver in [`../mobile`](../mobile/README.md) wraps the web UI), a mobile layout beyond
the responsive web app, and linking the desktop app to a server (desktop `OVERVIEW.md` roadmap
step 4). Uploaded subtitles belong to one file; they are not copied to other episodes.

## Host downloads

The head account opens **Profile → Downloads → Open downloads**, or the Downloads dock item. Viewers cannot access download settings or APIs. Movie and series searches, magnet links, preparation, progress, retry and removal use the desktop download browser and qBittorrent 5.1+. Only **Matro host** is offered; the browser device does not receive downloads.

Download settings asks only for the qBittorrent username and password. The server operator supplies the address and destinations through MATRO_QBITTORRENT_URL, MATRO_DOWNLOAD_MOVIES and MATRO_DOWNLOAD_SHOWS; defaults are http://127.0.0.1:8080 and Movies/Shows under MATRO_MEDIA. These folders must be within the registered library (using the Docker path mapping when needed). Connect verifies credentials before saving. Browsers cannot override the address or paths. Standard viewers have no Folders, Downloads or edition-comparison controls, and the API rejects access to their management routes. Finished jobs rescan the library automatically. Removing a transfer keeps files. Preparation and automatic transient-error recovery continue while the server runs.

The data directory contains downloads.json, download-jobs.json and downloads.key. The Web UI password uses AES-256-GCM with the private key file (mode 600); back up these files together, restrict access to the data volume, and never commit them. The key is stored on the same host, so filesystem access must be protected. API responses never return the password or key.

For Docker with different library and qBittorrent paths, set MATRO_DOWNLOAD_PATH_MAP to a JSON object mapping qBittorrent roots to container roots, for example {"/mnt/media/Movies":"/library/Movies","/mnt/media/Shows":"/library/Shows"}. The container only needs read access to these mounts; qBittorrent writes the files. Both clients must see the same underlying files. Paths are checked against registered library folders after resolving symlinks.

Run npm run sync-ui before a Docker build to include the shared download backend and renderer. The server has no desktop edition-upgrade/favorite management yet.
