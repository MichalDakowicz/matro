# Matro handoff

Updated 2026-11-20.

- Matro 0.7.8 is installed on Windows and Android and deployed to the home server. It includes Movies, Series and Anime discovery, seed-ranked listings, optional Prowlarr, TMDB previews, per-movie metadata languages, and reliable continuation across seasons.
- The 0.7.9 release brings the combined source into `main` and includes the ports of the desktop receiver and offline playback. The release branch preserves both original PR histories. [Release pull request](https://github.com/MichalDakowicz/matro/pull/19)
- Offline saves require a 0.7.9 or later server. The receiver test runs against a disconnected server after a full restart and checks that queued subtitle uploads arrive after reconnection. The native installer covers both ARM64 and x86-64.
- Live private tracker availability depends on configured Prowlarr indexers and accounts. The integration tests use fixtures for provider responses and torrent transfers.
