# Studyroom: SAT Tracker and Study Platform

Studyroom adds an offline study library, nested folders, Flashcards, adaptive Learn, practice Test, statistics, and class transcription to the existing SAT Question Bank Tracker. It uses plain HTML, CSS, and native JavaScript modules; no frontend framework or runtime package installation is needed.

## Active files

- `index.html`: unified navigation and platform shell.
- `sat.html`: original SAT application, with an added same-origin `SATBridge`. Its original executable script is preserved byte for byte.
- `assets/core.js`: stable records, imports/exports, folders, shared pools, backup validation.
- `assets/grading.js`, `assets/engine.js`: answer grading and the independent learning/testing engine.
- `assets/persistence.js`: IndexedDB records, binary audio, atomic writes, undo, causal revisions.
- `assets/sync.js`: separate Google Drive study revision files and optional audio uploads.
- `assets/app.js`, `assets/study-ui.js`, `assets/transcript-ui.js`: the working interfaces.
- `companion/`: optional authenticated local transcription and cloud AI service. Never deployed to GitHub Pages.
- `legacy_reference/`: private, disabled original source archives. Intentionally ignored by Git and excluded from the production build.

## Run locally

Requires Node.js 22 or newer and Python 3.10 or newer. From this folder:

```sh
npm test
npm run build
npm run dev
```

Open `http://127.0.0.1:8765`. `scripts/serve.py` serves **only `dist/`**, so the source archive and companion are not exposed. ES modules, IndexedDB, microphone permissions, service workers, and OAuth require HTTP(S); do not launch the app by double-clicking HTML files.

This computer's bundled Node is also available at `/Users/jxzhu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`. If Node is not on PATH, run that executable with `--test tests/*.test.mjs` and `scripts/build.mjs`, then run `python3 scripts/serve.py`.

The first online visit caches the public app. Later offline visits can open saved library data and the SAT tracker. Google login and external sun-position library loading still need their external services. System pronunciation voices may depend on the browser/OS.

## Deploy to the existing website

1. Review and commit the active source, tests, documents, and `.github/workflows/pages.yml`. Do not force-add the ignored archive, model files, recordings, API keys, or companion runtime data.
2. In GitHub repository **Settings → Pages**, select **GitHub Actions** as the source. This is essential: publish the `dist/` artifact, not the repository root.
3. Push `main`, or run the Pages workflow manually. It runs JavaScript and Python tests, builds the public allowlist, and deploys that artifact.
4. The public URL remains `https://3cn7.github.io`. The original OAuth authorized origin remains the same. Local testing needs the matching localhost authorized origin in the existing OAuth configuration.

No commit, push, repository setting change, or public deployment was performed during implementation. The workflow is ready for the repository's Pages configuration.

## Use the platform

- SAT Tracker opens the preserved editor, Math/R&W taxonomy, filters, timer, question navigation, import/export, and original Drive controls.
- Study Library creates sets and folders, imports lists, edits cards, supports global search, stars, pinning, sorting, and combined studying. Select sets, or open a folder and include its subfolders.
- All study modes use original card IDs. The setup dialog provides all/starred/unstarred/not-studied/learning/mastered and distinct historical-mistake filters.
- Flashcards supports flips, keyboard shortcuts, manual self-assessment, shuffled sequences, pronunciation, automatic playback, rounds, and resume.
- Learn uses direction-specific mastery and deterministic adaptive review. It supports correction, grading overrides, round summaries, and resume.
- Test freezes questions/options, saves responses, supports review marks, navigation, a persistent deadline, scoring, overrides, retakes, and test history. Matching questions and repeated-card tests are intentionally not included.
- Transcriptions records/uploads audio, edits text, preserves the original transcript, seeks timestamped segments, and reviews AI suggestions before saving. See `TRANSCRIPTION_SETUP.md` for the required service/model setup.
- Settings includes theme, companion configuration, storage usage, browser persistence requests, backups, Recently Deleted, and an explicit mastery reset.

Card editor keystrokes have a local recovery journal. IndexedDB writes are atomic. Set metadata drafts reopen in the editor. Transcript drafts restore when reopening their transcript. Export backups periodically: clearing browser data removes local records and audio.

## Tests

`npm test` runs the native Node test runner. `python3 -m unittest discover -s companion -p 'test_*.py' -v` runs companion tests. Cloud APIs and inference are mocked in these suites; the authentication server is real and temporarily binds loopback.

Optional browser suites use Playwright and an isolated browser profile while the preview server is running:

```sh
node tests/browser-smoke.mjs
node tests/browser-integrity.mjs
node tests/browser-learn.mjs
node tests/browser-transcript.mjs
node tests/browser-library.mjs
# or run all five: node scripts/test-browser.mjs
```

Install Playwright as a development tool if it is not available. `STUDY_PLAYWRIGHT_PATH` can point to an existing Playwright module; `STUDY_CHROME_PATH` can point to an installed Chrome executable. Test data stays in the isolated profile and does not touch the user's live browser.

See `VERIFICATION.md` for the actual checks and remaining integration verification.
