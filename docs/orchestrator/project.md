# Matro orchestration

- Repository `matro`. Electron desktop, Vite web, Node server, and Expo native share workspace packages.
- Design sources are `design/Downloads.artifact.html` and `design/*.dc.html`, followed by the existing UI and `docs/native-design.md`. Desktop leads Downloads. Native follows its own design for Continue Watching.
- Work is tracked in `docs/TASKS.md` and Brief project `f99babdc-f348-40f7-80b7-5e2bbb2a6761` (Matro).
- Run a full regression pass when the handoff predates the last merge. Testing commands and verification are in `CLAUDE.md`.
- Push verified work on `feat/discovery-and-series-progress` and open a PR into `main`. Deployment and merge require separate approval. Follow Matro’s sentence-style commit subjects.
- Use the Orchestrator role defaults. Keep provider and TMDB credentials in their existing host-side settings boundary.
