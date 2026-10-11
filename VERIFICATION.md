# Verification — October 10, 2026

## Automated checks

| Check | Actual result / boundary |
|---|---|
| JavaScript tests | 34 passed. Real core grading, scheduling, mastery, import/export, backup validation, clocks, legacy preservation; Drive HTTP responses mocked. |
| Companion tests | 8 passed. Real authenticated loopback HTTP server; inference and cloud responses mocked. Includes current multilingual multipart fields. |
| Browser smoke | Passed creation, Italian TSV import, stars, flip/self-assessment, Learn mistake/override, frozen test choices after refresh, submission/history, and 390 px layout. |
| Browser SAT/integrity | Passed seeded original Math/R&W records, IDs, notes/progress, search/filter/edit, original Drive export schema, durable edits, stale-record protection, offline reload, and unavailable-provider feedback. |
| Browser Learn | Passed one-card written mastery, Don't Know, enforced corrective retyping without mastery credit, atomic attempts/mastery/history, and completion after reload. |
| Browser transcript | Passed real upload validation/local audio storage/editor/recovery/review UI, approved-only saving, stars, mixed-language text preservation, source links, and memory-only service tokens. Provider responses mocked. |
| Browser library | Passed nested folders, IDs after movement, combined reversed study, autoplay pause, circular move guard, deletion/restoration with hierarchy, rapid written-answer persistence, and expired timer submission after refresh. |
| Build | Passed JavaScript syntax checks and production allowlist packaging. |
| Audio decoding | Actual FFmpeg/ffprobe decoded a generated 44.1 kHz stereo one-second WAV to 16 kHz mono; duration and sample count verified. No speech model was used. |
| Original source | Original archive HTML SHA-256 matches the pre-change source. Original executable SAT script hash matches in regression tests. |
| Deployment boundary | The public preview returned HTTP 200, and archive/companion/test paths each returned 404. Only index.html, sat.html, sw.js, public assets, and .nojekyll are in dist. Archive, companion, tests, documents, recordings, and models are excluded. |

Browser runs use isolated headless Chrome profiles and Playwright, not the user's live profile. Responsive screenshots were inspected. The native test suite also completes 1, 2, 3, 10, 100, and 1,000-card Learn pools, verifies recognition-only/written-only completion, prevents starvation, and keeps mastery separate by direction and from Flashcards self-assessment.

## Required manual integration checks

These were **not performed** and are not claimed as passing:

1. **Real Google OAuth/Drive and two devices:** configure the original OAuth client, connect, save SAT and a study set, verify their separate files, edit offline/reconnect, recover on another device, and deliberately edit the same card on both devices. Verify conflict choices and preserved SAT data. No account login/remote write was performed.
2. **Real local speech inference:** install faster-whisper and explicitly download a multilingual model using TRANSCRIPTION_SETUP.md. Upload a representative English/Italian lecture. No model was downloaded or real recognition run; decoding and the installed integration path are verified separately.
3. **Real cloud transcription and generation:** set OPENAI_API_KEY on the companion. Test original-language plain transcription, timestamps, diarization, and reviewed card generation. No paid requests or API key were available.
4. **Physical microphone and voices:** record a class with consent; inspect OS/browser permissions, audio playback, English/Italian pronunciation voices, and cancellation. Automated runs did not use the physical microphone.
5. **Public deployment:** select GitHub Actions as Pages source, review/commit/push, and inspect the deployed HTTPS site. No commit, push, repository setting change, or public deployment was performed.
6. **VS Code UI:** the workspace, active index, and original archive were opened through the VS Code CLI. Native GUI inspection was unavailable because Computer Use permission is not enabled; Explorer visibility is explicitly configured in the workspace.
7. **Other environments:** Safari, Firefox, mobile-to-companion networking, real long noisy lectures, and GPU inference were not tested. The documented companion deployment is desktop loopback, CPU inference.

## Known limits

Matching, repeated-card tests, long-term spaced repetition, semantic AI answer grading, local speaker diarization, and local text generation are not included. Clean transcript mode normalizes spacing; notes/translation remain separate AI output. Session elapsed time includes suspended intervals. Immutable Drive revisions accumulate without compaction, audio on another device requires manual download, and permanent local erase does not erase historical test snapshots or earlier Drive revisions. Inspect chunk boundaries when a quiet split is unavailable. Provider quality depends on the recording/model and was not measured with real speech.

See README.md, STUDY_ENGINE.md, SYNC_ARCHITECTURE.md, TRANSCRIPTION_SETUP.md, and LEGACY_REFERENCE.md for implemented behavior and exact setup commands.
