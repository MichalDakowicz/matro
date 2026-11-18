# Release sources for Matro Downloads

## Provider choice

| Use | Start with | Coverage and trade-offs |
| --- | --- | --- |
| Movies | Existing YTS catalog, plus optional Prowlarr with a general indexer such as 1337x | The built-in movie catalog keeps the setup simple. A general indexer can add different encodes and releases. Check coverage for the titles and languages you watch. |
| Shows | Existing TVmaze title lookup and EZTV releases, plus optional Prowlarr | EZTV can query by IMDb ID and offers a recent-release feed. Configured Prowlarr indexers can add older episodes and season packs. |
| Anime | Nyaa.si's published RSS feed, or Nyaa and additional anime indexers through Prowlarr | Nyaa specializes in East Asian media. Its structured feed includes info hashes and seed counts. Anime Tosho stopped ingesting releases in May 2026 and shut down its feeds in October. Merge identical info hashes without adding their seed counts. |
| General integration | Prowlarr, with Jackett as a self-hosted alternative to evaluate | Prowlarr offers a JSON search endpoint, source health and support for Torznab feeds and Cardigann definitions. Jackett also normalizes indexers to Torznab. A maintained adapter or published feed avoids adding site-specific HTML parsers to Matro. |

These recommendations are based on the providers' documented interfaces and coverage. On 2026-11-18 a read-only listing check from the development machine returned HTTP 200 from Nyaa RSS and EZTV JSON. The previous YTS host redirected to `yts.pw`, which returned the JSON listing directly. Availability, seed counts, and latency vary from the host running Matro. Rank a bounded batch of listings by reported seeds. A missing count stays unknown, and a newer observation can change the order. Compare providers using the same set of titles, including older shows, season packs, and anime searched under English and original titles. Record unique matching releases, reported seeds, response time, and failures.

[Prowlarr search API](https://wiki.servarr.com/en/prowlarr/search) · [Supported indexers](https://github.com/Servarr/Wiki/blob/master/prowlarr/supported-indexers.md) · [Jackett](https://github.com/Jackett/Jackett) · [EZTV API](https://eztvx.to/api/) · [Nyaa RSS implementation](https://github.com/nyaadevs/nyaa/blob/master/nyaa/templates/rss.xml) · [Anime Tosho shutdown notice](https://animetosho.org/)

## Title matches and release details

Use a known TMDB ID or map a known IMDb ID first. Without an ID, match the title and year within the right media type and keep uncertain matches unlinked. Film and TV searches include alternative titles. Use Matro's existing artwork cache and credential setup. Load richer details and season information when the user opens a title preview.

Anime releases can use absolute episode numbers, season and episode numbers, or a batch range. Show numbering as supplied when the mapping is uncertain. Explicit release tags can indicate possible audio or subtitle choices. Verify the tracks and language tags with Matro's existing media probe once the file is available.

[TMDB find by external ID](https://developer.themoviedb.org/reference/find-by-id) · [Movie and TV search](https://developer.themoviedb.org/docs/search-and-query-for-details) · [TMDB image configuration](https://developer.themoviedb.org/docs/image-basics) · [Sonarr anime numbering reference](https://wiki.servarr.com/sonarr/faq) · [FFprobe stream metadata](https://ffmpeg.org/ffprobe.html)
