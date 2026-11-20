# Downloads discovery and series progress

Approved 2026-11-18. The 0.7.9 release includes this work and the ports of the desktop receiver and offline playback.

Find movies, shows, and anime in Matro Downloads, preview the title with TMDB, compare available releases, and continue shows across episodes and seasons.

Downloads applies to standalone desktop and admin web, including desktop receiver mode. Continue Watching applies to desktop, web, and native.

## Done when

- [x] **Works.** Movies, Series, and Anime offer search and release selection. Anime accepts alternate titles and season or absolute numbering where available, with audio and subtitle hints. A browse view ranks releases by reported seeds. TMDB previews show poster, year, summary, and relevant title details. Continue Watching resumes a started episode or offers the next unfinished episode, including across seasons and after reload. Verified on `d903cef` with 39 passing Electron and web fixtures, 86 core tests, 25 server tests, and 13 native tests.
- [x] **Looks.** Downloads follows the existing poster grid and release dialog at desktop and narrow widths in both themes. Loading, empty, error, and missing-art states are legible. The independent Downloads fixture captured and checked dark desktop and 375 px light previews without horizontal overflow.
- [x] **Feels.** Search, previews, filters, and release selection are keyboard usable. Loading and provider errors preserve context and give the user a way to retry. The independent Downloads run checked keyboard focus, provider failures, and reload. The progress run verified keyboard activation of continuation and detail controls.
- [x] **Holds up.** Deduplicate mirrored releases and keep credentials host-side. Preserve access checks, download confirmation, managed-file preparation, watch history, and dismissals. Verified using mock download services, an authenticated admin and viewer run in the receiver UI, cross-device progress fixtures, and independent re-audits.
- [x] **Shipped.** The discovery and progress changes are installed and deployed in 0.7.8. The combined source, including the per-movie language setting and offline playback, is in the [0.7.9 release pull request](https://github.com/MichalDakowicz/matro/pull/19).
