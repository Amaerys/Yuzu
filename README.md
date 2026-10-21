# Yuzu

Spaced repetition for medicine. A progressive web app: install it on Android, iPhone, tablet or desktop from the browser.

- `src/` — source (React + TypeScript, no framework beyond that)
- `docs/` — built app, served by GitHub Pages
- `test/` — unit tests (`npm test`) and browser tests (`npm run e2e`)

Build: `npm run build`. Imports Anki `.colpkg` / `.apkg` files (media-free) with full review history, scheduled with FSRS.
