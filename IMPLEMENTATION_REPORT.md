# Engineering delivery report

## A. Implemented

An original Studyroom interface unifies the preserved SAT tracker with an offline Study Library, nested folders, shared card IDs/stars, import/export, Flashcards, adaptive Learn, frozen practice Test, statistics, draft recovery/undo/trash, versioned backups, Drive revision synchronization, and class transcription with reviewed AI study materials. The website uses native HTML/CSS/JavaScript; transcription uses an optional Python companion.

## B. Files

- Modified index.html into the unified shell; sat.html contains the preserved active SAT implementation and a small appended bridge; sw.js supplies the public offline cache.
- assets/: core.js, grading.js, engine.js, persistence.js, sync.js, ui.js, app.js, study-ui.js, transcription.js, transcript-ui.js, app.css, favicon.svg.
- companion/: server.py, download_model.py, requirements.txt, test_server.py.
- scripts/: build.mjs, serve.py, test-browser.mjs; tests/: core, sync, legacy, and five browser suites.
- .github/workflows/pages.yml, package.json, .gitignore, and 3cn7.github.io.code-workspace.
- README.md, STUDY_ENGINE.md, SYNC_ARCHITECTURE.md, TRANSCRIPTION_SETUP.md, LEGACY_REFERENCE.md, VERIFICATION.md, and this report.

## C. Original archive

legacy_reference/Original_SAT_Tracker.archived.txt is the exact original index.html, archived before changes. Original_Mathlive_Module.archived.txt preserves the earlier disabled notes module. The archive README explains its use. These private .txt files are inside the VS Code workspace, ignored by Git, never loaded by the app, and excluded from dist and deployment. The workspace explicitly displays the archive in Explorer.

## D. SAT preservation

The original executable script remains byte for byte intact in sat.html. Math/R&W slots and IDs, statuses/attempts/notes, taxonomy, search, filters, editing, Save-and-next, local saving/migration, imports/exports, timer/preferences, Google authentication, permission scope, Drive filename/data schema, conflict handling, and upload-race safeguards remain in place. Existing local and remote SAT data was not rewritten.

## E. Drive extension

The Study Library reuses the original in-memory OAuth token and drive.file permission. Separate immutable delta files tagged studyPlatform=v1 store versioned records. Per-device clocks merge independent changes and retain concurrent content for review. Tombstones prevent old devices reviving deletions; upload acknowledgements apply only to the exact uploaded versions. Optional audio is uploaded separately. The new adapter does not write the SAT file.

## F–G. Transcription configuration

TRANSCRIPTION_SETUP.md contains the commands. Install the Python companion dependencies and FFmpeg, run server.py, and enter its private loopback token in website Settings. For local speech, explicitly download tiny/small/large-v3 with download_model.py --consent. For cloud speech and reviewed AI material, set OPENAI_API_KEY in the companion environment. Cloud keys never enter the browser bundle. Local speech never falls back to cloud. English, Italian, mixed-language input, chunk progress/cancel/retry, original and edited text, and provenance are implemented.

## H. Passed checks

34 JavaScript tests, 8 Python companion tests, five real browser workflow suites, build/syntax checks, original-source hashes, and an actual FFmpeg decoding check. Cloud/inference mocks are identified explicitly in VERIFICATION.md. The UI includes actual saved records and working actions, not demo results.

## I. Unperformed checks

Real OAuth/Drive two-device verification, model inference, paid cloud speech/generation, physical microphone permissions/voices, and public deployment require configuration or manual checks. The VS Code workspace and archive were opened through its CLI; native GUI visibility could not be inspected because Computer Use permission is unavailable. No account data was deleted, no credentials were exposed, and no commit/push/deployment was performed.

## J. Limits

See VERIFICATION.md for precise limits: optional matching/spaced repetition, repeated-card tests, semantic AI grading, local text generation/diarization, Drive compaction/remote erasure, automatic audio redownload, and engagement-only timing are not included. The companion supports desktop loopback; recognition quality and real long-lecture boundaries still need representative recordings. External configuration remains necessary for the real transcription and cloud-saving workflows.
