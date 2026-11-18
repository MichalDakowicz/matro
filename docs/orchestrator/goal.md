# Downloads discovery and series progress

Approved 2026-11-18. Active.

Find movies, shows, and anime in Matro Downloads, preview the title with TMDB, compare available releases, and continue shows across episodes and seasons.

Downloads applies to standalone desktop and admin web, including desktop receiver mode. Continue Watching applies to desktop, web, and native.

## Done when

- [ ] **Works.** Movies, Series, and Anime offer search and release selection. Anime accepts alternate titles and season or absolute numbering where available, with audio and subtitle hints. A browse view ranks releases by reported seeds. TMDB previews show poster, year, summary, and relevant title details. Continue Watching resumes a started episode or offers the next unfinished episode, including across seasons and after reload. Verify with fixture-backed flows.
- [ ] **Looks.** Downloads follows the existing poster grid and release dialog at desktop and narrow widths in both themes. Loading, empty, error, and missing-art states are legible. Verify with Playwright and visual inspection.
- [ ] **Feels.** Search, previews, filters, and release selection are keyboard usable. Loading and provider errors preserve context and give the user a way to retry. Verify focus, status announcements, stale responses, and slow-provider behavior.
- [ ] **Holds up.** Deduplicate mirrored releases and keep credentials host-side. Preserve access checks, download confirmation, managed-file preparation, watch history, and dismissals. Verify with mock services, progress regressions, and an independent audit.
- [ ] **Shipped.** All applicable checks pass. Commit verified work, push the feature branch, open a PR for review, and update the task list, Brief, and handoff with evidence.
