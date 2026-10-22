# Yuzu

Spaced repetition for medicine. A progressive web app: install it on Android, iPhone, tablet or desktop from the browser.

- `src/` — source (React + TypeScript, no framework beyond that)
- `docs/` — built app, served by GitHub Pages
- `test/` — unit tests (`npm test`) and browser tests (`npm run e2e`)

Build: `npm run build`. Imports Anki `.colpkg` / `.apkg` files (media-free) with full review history, scheduled with FSRS.

## Development
- `npm run check` — type check (libs and UI), unit tests, build, browser e2e (phone + desktop) and the two-device sync e2e through a fake GitHub.
- `tools/probes/` — manual probes against the real collection (import timing, design screenshots, scheduler fit). They take file paths as arguments.
- Design: see `src/styles.css` (warm ink chrome, paper cards with a system-colored spine, Bricolage Grotesque). System colors live in `src/ui/theme.ts`.
