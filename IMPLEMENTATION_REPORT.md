# Studyroom refactor — engineering report

Website checkout: `/Users/jxzhu/Documents/GitHub/3cn7.github.io`.
The existing application was refactored in place. Changes are saved locally; they have not been pushed or published by this task.

## 1. Modifications

The application now centers on Dashboard, Study Library, Flashcards, Learn, Test, Transcripts, Statistics and Settings. It has independent local audio processing, incremental translations, reviewed card suggestions, a global timer and a shared theme system. The original study engine, grading, storage and card identity functions were retained.

## 2. Removed active functionality

Deleted `sat.html`, the tracker iframe/bridge/routes, question-bank dashboard metrics and controls, tracker CSS, inference provider/API-key configuration, remote speech/generation requests and the `companion/` Python backend. Deleted obsolete `tests/legacy.test.mjs`, `tests/browser-integrity.mjs` and `tests/browser-transcript.mjs`; replacement tests cover migration and browser-local transcripts. Active HTML, application assets, build scripts, workflow and package configuration have no dependencies on the retired features. Historical documentation and disabled archives may name them.

## 3. Historical archive and checkpoint

Checkpoint: `99f69a0d805327b894bf01b04edf58f0d5222660` on the existing main branch, created before the refactor. The original `legacy_reference/Original_SAT_Tracker.archived.txt` and disabled Mathlive reference remain readable in VS Code. Additional previous tracker/transcription/backend source is in `legacy_reference/pre_redesign/`. These `.txt` files are ignored and never copied into `dist/`. See `LEGACY_REFERENCE.md` for locations and the original checksum.

## 4. Universal timer

`assets/timer.js` generalizes the useful countdown behavior into an independent module, with a stopwatch, hour/minute/second countdown, Start/Pause/Resume/Reset/Restart, opt-in notification and sound, and Stop alert. It persists timestamp anchors and paused values in localStorage. It calculates elapsed time after navigation, refresh or suspension rather than counting interval ticks. Tabs share state and coordinate the completion announcement. The header readout stays available throughout the app; the expanded panel reserves layout space. Existing timed tests retain their separate deadlines.

## 5. Browser-native transcription

`getUserMedia` feeds Web Audio and an AudioWorklet. Mono PCM is resampled to 16 kHz and processed in chronological, non-overlapping eight-second chunks by a dedicated inference worker. Start/Pause/Resume/Stop, capture time, backlog, cancellation and errors are visible. Finalized text is saved incrementally. Uploads decode locally; files longer than three minutes use a bounded decoder at playback speed. Raw recordings stay in local IndexedDB. Original recognition, edited text, language assignment, timestamps and edit history remain separate.

## 6. Speech models

All use q8 encoder and merged decoder ONNX weights, pinned to exact repository revisions in `assets/models.js`.

| Option        | Exact repository               | Pinned revision                            |          Download |
| ------------- | ------------------------------ | ------------------------------------------ | ----------------: |
| Fast, default | `onnx-community/whisper-tiny`  | `ff4177021cc41f7db950912b73ea4fdf7d01d8e7` |  43,615,928 bytes |
| Balanced      | `onnx-community/whisper-base`  | `1846881b6b3a3024392c1eea3ad983695bc23925` |  79,666,385 bytes |
| High accuracy | `onnx-community/whisper-small` | `36050c46d777d46dc4b5f43f6d90574fc38f8732` | 251,848,807 bytes |

These variants are multilingual. Auto/mixed recognition compares Whisper's English and Italian language logits per chunk, then explicitly requests transcription in the detected language. This corrects the pinned library's English default. Sentence language heuristics and manual overrides supplement detection.

## 7. Translation models

| Direction         | Exact repository       | Pinned revision                            |          Download |
| ----------------- | ---------------------- | ------------------------------------------ | ----------------: |
| Italian → English | `Xenova/opus-mt-it-en` | `fd0b89b9c052adc1f2f64152f555aa17353728be` | 136,865,467 bytes |
| English → Italian | `Xenova/opus-mt-en-it` | `075406e3c8c2c30634d4a1bd8f00c21d9e162011` | 136,474,118 bytes |

A separate worker incrementally translates finalized segments. Signatures prevent repeating completed translations. Text already in the target language stays as-is. Translation can continue after capture stops. Desktop pairs originals and translations; mobile stacks them. Manual edits win over pending inference responses. Card suggestions use local extractive rules and require review before saving.

## 8. WebGPU and WebAssembly

Transformers.js is pinned to **3.8.1**. The complete browser bundle and ONNX Runtime JSEP/WASM are shipped with the static artifact. Automatic device selection prefers an available GPU. Failed model initialization selects WASM. The first actual GPU result is compared against local WASM before it is saved; disagreement selects WASM with a visible message. On this tested Mac, GPU graphs loaded but produced incorrect q8 output. The working inference path was **WebAssembly**, including verified fallback during offline use. This report does not claim successful GPU acceleration or identical device performance.

## 9. Offline caching

Cache Storage holds model files under `studyroom-models-v1` and the three runtime files under `studyroom-runtime-v2`. Readiness checks every manifest entry, stored byte length and runtime file. Incomplete downloads are rejected; retries retain completed files, and browser locks prevent duplicate downloads. The UI distinguishes Not installed, Downloading, Loading, Ready and Error. The application service worker uses a build-content version and retains the model/runtime caches across UI updates.

## 10. Initial downloads

The model manager shows size and asks for explicit download confirmation. Fast is about 42 MiB; the runtime adds about 22 MiB. Each translation direction adds about 130 MiB. Balanced is about 76 MiB and High about 240 MiB. No speech model is silently downloaded and no remote inference fallback exists. Cache eviction or clearing site data requires downloading again; storage persistence can be requested in Settings.

## 11. Repaired themes

The previous embedded page and separate styling systems prevented consistent themes. A single light/dark token system now covers all application surfaces, inputs, menus, dialogs, timer and study feedback. Light, Dark and System are persisted. Initial HTML applies the preference before the main UI is displayed. System responds to `prefers-color-scheme` changes. Browser checks cover explicit dark refresh and navigation, System changes and both palettes across populated pages.

## 12. Interface improvements

Five main navigation destinations, consistent typography and spacing, 44px controls, clear creation actions, recent/pinned study items, wrapping card content and contextual secondary menus reduce crowding. Library tiles expose title, folder, term/star counts, mastery and study date. Advanced study/playback settings and models use disclosures. The transcript workspace centers capture, languages and editable original/translated pairs. Mobile dialogs scroll with reachable actions. See `UI_AUDIT.md`.

## 13. Preserved Drive and data

Existing record IDs, folder relations, stars, directional mastery, resumed sessions, test snapshots and wire schema remain compatible. First updated launch atomically validates and snapshots existing study records and prior localStorage before feature initialization. No database or historical keys are cleared. Settings can export that snapshot and merge its study records back. Existing audio remains in its original store. The actual user's browser data was not inspected; the snapshot occurs when they first open the updated site on its existing origin.

The retained Drive adapter continues local-first saving, five-second debounce, Save Now, offline behavior, immutable JSON revisions, vector-clock conflicts, tombstones and exact uploaded-clock acknowledgments. It never modifies historical tracker files or uploads raw audio, live chunks, model files or migration metadata. Standalone Google Identity Services authorization retains `drive.file` and memory-only tokens. Saved text and translations may be synchronized when the user enables Drive.

## 14. Verification

**36 Node tests, eight browser suites and the separate real-model inference suite passed.** Both translation directions, mixed-language routing, offline reload, synthetic microphone capture, saved-audio streaming and all five requested audio decoders were exercised. See `VERIFICATION.md` for test results, commands, screenshots and the exact limits of device testing. The code checkpoint and production allowlist provide source rollback and private archive exclusion. Tests use isolated browser profiles, not the user's personal study database.

## 15. Known limitations

- Physical microphone input, OS notification delivery and audible alerts require a device check. Automated capture uses Chrome's synthetic input device with generated speech; actual Whisper and OPUS inference runs without mocks.
- Fast recognition can mishear words and names, especially at chunk boundaries. Mixed switches inside one chunk are imperfect. Timestamps and sentence boundaries are approximate; no confidence scores are invented.
- Balanced and High accuracy were installed and run on this Mac (WebAssembly) in the follow-up verification; High accuracy takes about 2.5× the audio length, so it suits uploads rather than live recording. Available memory and browser/driver support vary.
- First GPU verification adds latency and temporarily loads a CPU model. This Mac needed WASM fallback.
- Tests use short speech samples and bounded streaming capture, not a complete hour-long class. Files are limited to 100 MB/one hour, or 40 MB on low-memory devices. Codec support varies. Finalized text is durable; stop capture before closing to retain raw audio still held in memory.
- Live Google authorization and account uploads were not performed. Adapter tests cover actual request construction and conflict behavior against controlled responses. User OAuth client configuration must authorize the website origin.
- Browser zoom was emulated using CSS viewport size and DPR, not the native Chrome zoom menu. Automated layout checks and token contrast are not a full accessibility audit.
- Sound after a page reload can be restricted by browser autoplay rules. A suspended/closed page may announce expiry when it resumes; timestamp arithmetic still restores the correct elapsed value.
- Local card creation is extractive and reviewed; it does not use a generative language model. Existing study-engine limitations remain documented in `STUDY_ENGINE.md`.

## 16. Setup

Use Node 22+ and pnpm 11.25: `pnpm install --frozen-lockfile --ignore-scripts`, `pnpm test`, `pnpm build`, then `pnpm dev`. Open localhost port 8765. Only `dist/` is public. GitHub Pages builds it through the retained deployment workflow when changes are pushed to main. Production microphone access requires HTTPS; `file://` is unsupported. Download desired local models in Settings, optionally configure the Google OAuth client, and connect Drive only if synchronization is wanted. See `README.md`, `TRANSCRIPTION_SETUP.md` and `SYNC_ARCHITECTURE.md`.

## 17. Follow-up changes (October 11, 2026)

Code is saved locally only; nothing was pushed or deployed.

- **Interface:** the "S" is the favicon's symmetric path in a square viewBox (centred by geometry); the saved status and Drive link are separate blocks; the study header no longer has a back link; the global Undo button is gone and **Undo** appears only in a set's card editor (scoped undo entries in `persistence.js`); the dashboard lost "+ New study set" and its hero now shows the study streak (`assets/streak.js`) beside the unchanged illustration; **+ Create** also stays visible on narrow screens.
- **Study state:** Flashcards, Learn and Test resume exactly (current card/question, flip, graded feedback, typed draft, hint, answers, marks, auto-play offer). Study time (`activeMs`) counts only time on screen; a timed test keeps `remainingMs`, pauses when the learner leaves and is never submitted while away. New fields are additive; older sessions and tests still open (a legacy test whose `deadline` had passed asks before submitting). Resume is offered on the dashboard and in the setup dialog.
- **Learn shortcuts:** Enter (submit/continue, never while typing, before grading or on a focused control), 1–4/T/F, D, Alt+H, S, `?`, with focus moved to Continue and the keys shown in the interface.
- **Reset Learn progress** for one set, under More set actions, with a confirmation; it also resets that set's copy of mastery in unfinished Learn sessions.
- **Study Library** (`assets/library-ui.js`): grid and folder-tree views, drag-and-drop for sets, selections and folders, Move buttons and dialog as the non-drag path, breadcrumb drops, keyboard-operable ARIA tree. A folder now shows what is directly inside it (**Include subfolders** to flatten). Research and decisions are in `UI_AUDIT.md`.
- **Model downloads** (`assets/model-manager.js`): retry with backoff, `Range` resume, kept partial bytes, plain-language errors, **Check connection**, optional download address, a High accuracy offer with a header progress chip, `pnpm verify:models`. The "Failed to fetch" investigation and the High accuracy size/hosting/licence decision are in `TRANSCRIPTION_SETUP.md`.
- **Tests:** the stale Learn heading and backlog/upload assertions were updated; new suites cover streaks, model downloads, study state, interface, file manager and download recovery (59 Node tests, 12 browser suites and the real-model suite; see `VERIFICATION.md`).
- **Not done / limits:** the cause of the original "Failed to fetch" could not be reproduced from this Mac (see TRANSCRIPTION_SETUP.md); touch-screen dragging and a physical microphone were not tested; no new Undo was added for library moves because Undo was limited to card editing.
