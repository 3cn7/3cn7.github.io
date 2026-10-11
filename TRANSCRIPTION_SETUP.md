# Transcription and AI material setup

The website stays on GitHub Pages. Transcription runs through an **optional authenticated loopback companion**, `companion/server.py`. It binds `127.0.0.1` and accepts the existing website origin plus the local preview. Public JavaScript never contains a cloud API key. A separate text-generation request creates editable suggestions; it is not automatically available merely because speech recognition is installed.

## Install the local engine

Use Python 3.11–3.13 with available CTranslate2 wheels. Python 3.13 is installed on this computer at `/Library/Frameworks/Python.framework/Versions/3.13/bin/python3.13`.

```sh
cd companion
python3.13 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

Install FFmpeg/ffprobe using your package manager (macOS: `brew install ffmpeg`). They are already available on the implementation computer. This service uses CPU inference (`int8`) and does not require a browser GPU.

Explicitly select and download a multilingual model:

```sh
python download_model.py fast --consent
# or: python download_model.py balanced --consent
# or: python download_model.py high --consent
```

The download command refuses to start without `--consent`. Approximate sizes: Fast/tiny ~75 MB; Balanced/small ~500 MB; High/large-v3 ~3 GB. Memory needs exceed model file size; tiny can fit on modest computers, while large-v3 may require several GB and can be slow on CPU. Actual recognition depends on recording quality, speech, and language. These are quality/speed choices, not accuracy guarantees. Do not use `.en` models for Italian or mixed speech.

Models are saved in `companion/models/` and are ignored by Git. Inference uses `local_files_only=True`: it never initiates a model download, never calls a cloud provider in local mode, and works offline once its dependencies/models are available. Local mode supports multilingual Whisper with per-segment language detection for the mixed English/Italian option. Local speaker diarization is not implemented.

## Start and connect

```sh
python server.py
```

The private terminal shows the loopback URL and a randomly generated access token. In website **Settings**, enter `http://127.0.0.1:8766` and that token, save, then Check connection. Keep the terminal private. Only the URL is saved locally; the token must be entered again after refreshing or reopening the tab. Alternatively set `STUDY_COMPANION_TOKEN` in the service environment for a stable secret that you manage yourself.

A browser may ask to allow access from the HTTPS website to a local service. Use a supported desktop browser that allows loopback/local network requests. A phone cannot reach a service on another device through its own `127.0.0.1`; local desktop processing is the supported deployment for this companion. Do not expose this HTTP service to a public network. `STUDY_ALLOWED_ORIGINS` can list additional trusted preview origins; wildcard origins are not accepted. Cloud generation and every job endpoint require the companion Bearer token.

## Configure cloud speech and text generation

Set `OPENAI_API_KEY` in the **companion process environment**, then start the service. Do not paste this cloud key into website Settings, source files, VS Code workspace settings, or Git. No `.env` file is required.

- Plain original-language transcription: default `gpt-transcribe`, configurable through `STUDY_TRANSCRIBE_MODEL`. This model receives `languages[]` hints (English + Italian for mixed recordings); older specialized models receive a singular `language` only when appropriate.
- Requested segment timestamps without speaker labels: `whisper-1` with `verbose_json` and segment timestamp granularities.
- Requested speaker labels: `gpt-4o-transcribe-diarize`, `diarized_json`, `chunking_strategy=auto`. Labels are scoped to provider/chunk output; stable identities across a full lecture are not inferred.
- Notes, flashcard suggestions, and separate translation: Responses API, `STUDY_TEXT_MODEL` default `gpt-6.1-sol`, strict JSON schema. Only reviewed cards are saved. The original transcript is not overwritten by translation or summaries.

The frontend always asks for the engine; choosing local does not fall back to cloud. Selecting cloud authorizes sending that recording to OpenAI and may incur charges. If no key is configured, the UI reports **CLOUD TRANSCRIPTION NOT CONFIGURED**. Text generation also reports missing configuration. No fake transcription or card output is used.

The implementation follows the current [OpenAI file transcription documentation](https://developers.openai.com/api/docs/guides/speech-to-text) and [faster-whisper implementation](https://github.com/SYSTRAN/faster-whisper). Model availability can change; update environment selections according to provider documentation if needed.

## Audio pipeline

The browser checks known file signatures, then the companion streams up to 500 MB to a private temporary file and validates its actual audio track with ffprobe. Supported input depends on installed FFmpeg decoders (MP3, M4A/MP4, WAV, WebM, Ogg, FLAC). Maximum recording duration: six hours; split larger/longer files before upload. Live browser microphone recording uses MediaRecorder and requests audio permission explicitly.

FFmpeg locates silence and builds contiguous, nonoverlapping windows of up to nine minutes. Each window is decoded to 16 kHz mono WAV, safely below the provider's 25 MB file limit. This avoids decoding a full lecture into browser memory and preserves order without overlapping duplicate boundary passages. If a quiet boundary is unavailable, a fixed split may cut a spoken word; inspect those passages. Provider-supplied timestamps are offset to their global recording position. Models with no reliable timestamps produce no fabricated segment timings.

Local inference yields timestamped segments and marks low-confidence passages when its confidence values are available. Cloud confidence may be absent. Original wording, edited transcript, and recent edit history are stored separately. Clean mode currently normalizes spacing; it does not remove fillers or rewrite meaning. Optional AI notes can improve organization without replacing the original transcript.

Jobs expose real validation/chunk progress and cancellation. Completed chunks are checkpointed privately. Retrying a failed job can resume its completed chunks; a crashed service reloads job records and marks interrupted jobs retryable. Successful processing deletes its uploaded temporary audio; frontend original audio follows the user's selected retention policy. Failed/cancelled temporary files remain to support retry and should be removed from `companion/private_data/` when no longer needed. Private runtime files are ignored by Git and excluded from the production artifact.

## Actual verification and limits

Companion authentication, origin restriction, chunk order, timestamp offsets, missing models, cancellation, language preservation of provider responses, and structured generation are tested. Provider responses and model inference are mocked. Actual FFmpeg/ffprobe decoding was verified with a generated one-second WAV, including 44.1 kHz stereo to 16 kHz mono conversion. No large model was downloaded without consent, and no real local inference or paid cloud transcription/generation was run during implementation. To complete those manual checks, install a model or configure the key and use an English/Italian recording with known speech. Review all AI output before saving study materials.
