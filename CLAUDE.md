# Matro — agent notes

## Commits, pull requests and releases

- Do not credit Claude or any AI tool in commits, pull requests or release notes.
- No `Co-Authored-By:` trailers in commit messages.
- No "Generated with Claude Code" (or similar) lines in PR descriptions or release notes.

## Testing

- Run `npm run build:web` before `npm run test:server` on a fresh checkout. Before integration, also run `npm test`, `npm run test:mobile`, `npm run typecheck:mobile`, and `npm run test:e2e`. Playwright builds the Vite app as part of its setup.
- Verify desktop and web flows with the existing Playwright fixtures. Use `npm start` for manual desktop checks or `npm run dev:web` with the project server for manual web checks. Use an isolated profile, server data directory, and mock download providers for automated tests. Keep any running user instances in place.
- Check changed screens in both themes, at desktop and narrow web widths, and through their keyboard paths. Exercise reload and failure states for any changed network or watch-progress flow. Report what was verified on native separately from desktop and web.
