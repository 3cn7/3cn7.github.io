# Studyroom

A static, local-first study application for [3cn7.github.io](https://3cn7.github.io): folders, flashcard sets, stars, adaptive Learn, tests, local class transcription/translation, and a universal timer. Google Drive optionally synchronizes saved JSON records. Audio recognition, translation and card extraction run on the device.

## Run locally

Node 22+ and pnpm 11.25:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm run build
pnpm run dev
```

Open [http://127.0.0.1:8765](http://127.0.0.1:8765). Serve only `dist/`. The app requires HTTPS or localhost for microphone and browser model caching; opening index.html with file:// is unsupported. The Pages workflow builds and deploys the public artifact when main is pushed. No inference server, API key or paid service is required.

## First recording

In Settings or Transcriptions, download Fast speech recognition (about 42 MiB). High accuracy (Whisper Small, about 240 MiB) is offered on the dashboard and Transcripts page and suits uploaded recordings. Enable live translation only after downloading the desired direction (about 130 MiB each). Downloads require explicit confirmation, retry automatically, resume after interruptions and explain failures (see [Browser transcription setup](TRANSCRIPTION_SETUP.md)). Start recording or upload audio. Original and translated text remain separate and editable. File limits: 100 MB / one hour, 40 MB on low-memory devices. Files over three minutes use bounded streaming decoding at playback speed.

Local suggestions extract term/definition lines and sentence prompts; review them before saving. They do not invent facts or use a cloud text model.

## Data and compatibility

The established IndexedDB database, record IDs, directional mastery, sessions, historical test snapshots, stars and Drive revision format remain compatible. First launch saves a local migration backup before enabling the study-only app; Settings lets you export it or merge its earlier study records. Historical browser keys are left intact. Existing recordings stay local. Access tokens are held only in memory.

The original reference archive remains in `legacy_reference/`, ignored and excluded from deployment. The pre-redesign code checkpoint is `99f69a0d805327b894bf01b04edf58f0d5222660`.

- [Browser transcription setup](TRANSCRIPTION_SETUP.md)
- [Sync and migration](SYNC_ARCHITECTURE.md)
- [Learning engine](STUDY_ENGINE.md)
- [Interface audit](UI_AUDIT.md)
- [Verification](VERIFICATION.md)
- [Implementation report](IMPLEMENTATION_REPORT.md)

## Browser checks

Keep the local preview running. Install the test browser once with `pnpm exec playwright install chromium`, then use `pnpm test:browser` (it includes the study-state, file-manager, interface and download-recovery suites; no internet needed). To use an installed Chrome instead, set `STUDY_CHROME_PATH` to its executable. `pnpm test:models` additionally downloads real model files into an isolated test browser profile and runs synthetic speech through capture, recognition and translation. Its fixtures contain generated English and Italian speech, not user recordings. `pnpm verify:models` checks the pinned model files against the live hosts (internet required). These checks do not test the computer's physical microphone.
