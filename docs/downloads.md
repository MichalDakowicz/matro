# Downloads, storage layouts and seeding

Open Downloads in the dock. Search movie releases through YTS, or use Add a movie or show magnet for an existing magnet link. CineCLI is the reference flow; it is not a runtime dependency.

## Destinations and storage

Configure This PC and Server independently under Download settings. Each needs qBittorrent 5.1 or newer with its Web UI enabled. Test and save checks authentication before changing the saved profile. Passwords are OS-encrypted; a blank password retains the existing secret only for an unchanged client address and username.

The default server preset follows the existing media library inspected on 2026-10-30:

- Movies root: /mnt/media/Movies; layout: Title/Title (Year) [1080p].mkv
- Shows root: /mnt/media/Shows; layout: Title/S01/S01E01 Title (Year) [1080p].mkv
- Text subtitles sit beside their video with a matching stem and a language suffix

The inspected library also has shows without season folders. Choose Title/episodes to use that approach. Other choices include movie title-and-year folders, flat roots, original torrent folders, and original filenames. Roots and layouts are separate for each download destination. Local defaults are Movies and Shows inside the user's Videos folder. An existing custom save folder is migrated to the movie root; the old server downloads/complete default is migrated to /mnt/media/Movies.

For Server downloads, connect the same host and media root under Folders → Connect SSH. Matro uses that connection to check destination files before moving a prepared torrent. It leaves the torrent stopped if it cannot safely check the remote destination. Existing filenames are preserved by using a distinct hash-suffixed edition on collision; if that edition already exists, preparation stops with an error.

## Media selection

New magnets use qBittorrent's MetadataReceived stop condition. The client fetches metadata and stops before the payload. Matro selects the largest non-sample feature for movies, or numbered episodes for shows, and optional SRT/ASS/SSA/VTT subtitles. Images, TXT/NFO files, executables, samples, trailers and extras are assigned priority zero. Movie subtitles are renamed alongside the feature; show subtitles are matched by episode number or matching video basename. Files with unsafe paths, no playable video, or unknown episode numbering for season layouts remain stopped for review.

Matro verifies renamed paths and priorities before starting the payload. If Matro closes during preparation, qBittorrent stays stopped after metadata and preparation resumes when Matro opens again. Failed preparation has a Retry preparation button. Managed job ownership tags prevent modifying unrelated or pre-existing torrents. Original torrents already present in qBittorrent are reported as duplicates and are not relocated or filtered.

Jobs initially use a private .matro-pending directory under the selected media root. After selection and renaming, the job is relocated to that root and started. Matro sets useDownloadPath=false and autoTMM=false for these new torrents: the client's global incomplete folder no longer overrides the chosen root. Existing transfers may still use the server's configured /mnt/media/downloads/incomplete folder until completion. Their final and temporary paths are shown separately. Hidden preparation directories are excluded from library scans.

BitTorrent pieces can overlap skipped files, so the client may retain small unwanted boundary data. Priority zero avoids selecting extras; it cannot guarantee zero bytes associated with unwanted pieces. Matro never deletes existing files as a cleanup step.

## Seeding

Before the first download, Matro asks Seed after downloading? The user can remember the choice. Download settings offers Ask, Yes, or No for subsequent downloads. Yes sets unlimited per-torrent seeding. No sets ratio/time zero with the Stop action, keeping the completed files. qBittorrent enforces this even if Matro is closed. BitTorrent may upload pieces while downloading; No means no seeding after completion.

## Files and checks

- downloads.json: client profiles, encrypted passwords, layouts and saved seeding preference in Electron user-data
- download-jobs.json: persistent metadata/preparation plans and statuses; no plaintext credentials
- electron/torrents.cjs: catalog, authentication, submission and preferences
- electron/download-layout.cjs: media selection and file layout planning
- electron/download-jobs.cjs: durable preparation, priorities, rename verification and start
- electron/download-files.cjs: local/SSH destination collision checks
- src/downloads.js and src/downloads.css: UI

Run npm test for media/service/layout checks and npm run test:e2e for Electron checks. node --test tests/torrents.test.cjs tests/download-layout.test.cjs runs the download backend checks alone. The tests use mock torrent clients, isolated profiles and generated media; they do not download real movie payloads. MATRO_TORRENT_API overrides the catalog for development fixtures only; packaged apps ignore it.

For a connection failure, check the Web UI address, credentials, CSRF/host validation and login bans. Temporary connection errors retry automatically with a 10–60 second backoff; permanent authentication or configuration errors still need attention. Refresh downloads checks immediately. Keep client protections enabled. An unseeded magnet may wait indefinitely for metadata. Failed file permissions and disk capacity are reported by the client's transfer state. Search sends the query to YTS only on submit; a provider outage does not affect playback.

References: [qBittorrent API](https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-%28qBittorrent-5.0%29), [qBittorrent 5.1.4 submission implementation](https://github.com/qbittorrent/qBittorrent/blob/release-5.1.4/src/webui/api/torrentscontroller.cpp), [CineCLI](https://github.com/eyeblech/cinecli).

## Movie upgrades and editions

Open a movie's details and choose Find better quality / compare editions. Matro
reads its actual dimensions, codec, size and duration. Only a higher resolution
can be submitted as an upgrade. Cropped widescreen files are classified by width
as well as height, so 1920 x 800 is the 1080p class. Resolution alone does not
guarantee a better encode; compare data rates and actual playback as well.

Default movie filenames are Title (Year) [1080p].mkv. Episode names are
S01E01 Title (Year) [1080p].mkv. Subtitles share that stem plus a language suffix.
Resolution comes from the selected release or torrent filename. Missing metadata
is labelled resolution unknown. Original filenames remain an optional setting.
Upgrade filenames add a short hash suffix so both editions remain distinct.

The original file is never deleted or replaced. A completed upgrade is probed and
must really have a higher resolution before it becomes a registered edition.
New managed movie paths are excluded from library imports until completion.
Completed movies are added automatically; shows can be picked up with Rescan.
Rescans preserve movie editions as movies rather than treating the folder as a show.

The comparison panel has Play this edition and Make favorite. It shows resolution,
codec, size and average overall data rate. Play this edition opens that exact file.
Ordinary playback opens the saved favorite; the original remains the favorite
until the user chooses another. movieEditions and managedMoviePaths in library.json
persist edition identities and favorites. Original watch progress is preserved.

Tests: node --test tests/movie-upgrades.test.cjs checks resolution, retention and
favorite persistence; npx playwright test tests/upgrades.spec.cjs exercises the
whole workflow using generated media and a mock torrent client, including disk
contents, skipped files, restarts, rescans and comparison playback.


## Separate movie and series browsers

Downloads now has distinct Movies and Series buttons. Each preserves its own
search text/results; movie-upgrade comparison stays in Movies. Switching does
not submit a search or start a transfer. The destination preview switches between
the configured movie root and show root.

Series search uses TVmaze for exact show selection, then EZTV's IMDb-filtered
release API for that show's torrents. No API key is required. The UI credits
TVmaze, links each show to its source and links the CC BY-SA 4.0 data license.
Summaries are stripped of HTML and shortened. No remote images are loaded.
Typing performs no requests: Search series submits the title; Choose episodes
loads release metadata. The UI explains which provider receives each action.

Series releases have Season, Episode and Resolution filters, independent of
movie search. The release API is paginated. More releases continues with older
provider pages. A filtered request checks up to three pages until it finds
matches; the UI shows which pages were checked and can continue further. Empty
filtered pages do not imply that the entire series has no matching release.
Release pages are cached for five minutes; show selections expire after an hour.

Selecting a release uses the existing explicit download/seeding flow. The cached
release is typed as a show and routes to the configured Shows root, season layout
and episode-first filename. For a single-episode release, its catalog episode
number can identify an otherwise unnumbered video filename. Season packs retain
the numbered episodes in their file list. The same subtitle/extra selection and
metadata-first preparation rules apply. A series release cannot become a movie
upgrade. Completed shows can be imported using Rescan.

The manual magnet form is also separate: Add a movie magnet in Movies, Add a
series magnet in Series. Shows without an IMDb release index can still use the
series magnet form. Provider availability and seed counts can change; a listing
is not a promise that a transfer will have peers. No release downloads until the
user explicitly selects it.

Implementation: electron/series-catalog.cjs, narrow series IPC methods in main/
preload, and the Series view in src/downloads.js. Development tests may override
MATRO_SERIES_METADATA_API and MATRO_SERIES_RELEASES_API; packaged apps ignore them.
Tests: node --test tests/series.test.cjs and npx playwright test tests/series.spec.cjs.
These use mock clients and never start a real movie/show torrent.

References: [TVmaze API](https://www.tvmaze.com/api),
[EZTV API](https://eztvx.to/api/),
[TVmaze data license](https://creativecommons.org/licenses/by-sa/4.0/).

## Public Web UI and a separate SSH address

The Server connection has an optional **SSH server address (if different)** field.
For Michu's server use Web UI `https://dakowicz.xyz/torrent/` and SSH server address
`192.168.100.6`, with the existing SSH media connection rooted at `/mnt/media`.
A blank SSH address retains the original behavior of matching the Web UI hostname.
This explicit mapping is saved as `sshHost` in the client profile and is used for
destination collision checks and movie import paths. It never creates an SSH
connection: the matching saved connection and its media-root boundary are still
required. Web authentication continues using the public HTTPS address.

Before this fix, both manual magnets and catalog results stopped after metadata
when the public Web UI hostname differed from the SSH host. Preparation reported
that the SSH media root needed connecting even when the LAN SSH connection existed.
Set the separate SSH address, save, and choose Retry preparation for that failed
job. Do not bypass preparation with a raw start: it selects media files and protects
existing destinations before resuming the download. The current installed app was
updated on 2026-10-31 and the existing failed job resumed successfully.

Regression checks: `node --test tests/torrents.test.cjs tests/download-layout.test.cjs tests/movie-upgrades.test.cjs`
(17 tests passed); the settings renderer also passed ES module syntax validation.

## Removing download entries and card backgrounds

Download activity cards have a remove button. Confirming **Remove download** stops
and removes the transfer from qBittorrent and clears its Matro job history, while
keeping downloaded files (`deleteFiles=false`). Cancel with **Keep download** or
Escape. Failed preparation entries can be dismissed even if their torrent has
already been removed. If the API request fails, the history stays available for
retry. Removal waits for any in-flight preparation before deleting, and the job
worker cannot restart a removed transfer. No file-deletion option is offered.

Activity cards use the movie or series banner from the existing local TMDB artwork
cache, with a dark overlay for legible text. A poster is used when there is no
banner; unmatched titles keep their coloured background. Artwork is fetched through
the existing metadata service when configured and appears on a subsequent refresh.
Both manual magnets and catalog downloads use the same job title/year for matching.
Preparing and failed downloads each have a single card instead of duplicate cards.

`node scripts/verify-download-cards.cjs` runs an isolated Electron test with a mock
torrent client and generated cached artwork. It checks loaded images, cancellation,
file-preserving removal and dismissal of a stale failed entry. Related backend
regressions are in torrents.test.cjs and download-layout.test.cjs.

The remove button appears on card hover or keyboard focus (always visible on touch). Transfer speed sits directly beside it with a 6 px gap.


## Temporary outages and automatic recovery

Temporary network failures and HTTP 408, 429 and 5xx responses (including Cloudflare
530) now show Reconnecting and retry after 10, 20, 40 and then at most every 60
seconds. Preparation keeps its saved phase and plan, and continues automatically
when the client is reachable. Active transfers are not submitted again. The worker
runs while Matro is open; the visible Downloads page resumes its normal five-second
polling after recovery. Refresh downloads bypasses the activity backoff.

Existing saved temporary processing errors with a resumePhase are recovered on
startup. Failed initial submissions are not automatically repeated. Credentials,
ownership and file-safety errors remain errors for review. The retry schedule is
persisted across app restarts. Successful checks clear transient errors and reset
the backoff. A removed download still cannot be restarted by recovery.

Regression checks cover HTTP 530, transient login responses, capped retry timing,
restart persistence, saved old-error migration, and permanent-error handling.
node scripts/verify-download-cards.cjs also simulates a temporary tunnel outage and
verifies automatic UI polling recovery without a manual refresh.
