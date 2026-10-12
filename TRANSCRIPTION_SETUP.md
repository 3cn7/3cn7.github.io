# Browser transcription and translation

## Runtime

Transformers.js **3.8.1** is pinned to the stable documentation version researched for this implementation. Its full browser bundle and ONNX Runtime JSEP module/WASM are served from `dist/vendor/`; there is no runtime CDN dependency. The browser workers use q8 weights and exact pinned model revisions from `assets/models.js`.

| Purpose                       | Repository                   | Approximate model download |
| ----------------------------- | ---------------------------- | -------------------------: |
| Fast, default                 | onnx-community/whisper-tiny  |                     42 MiB |
| Balanced                      | onnx-community/whisper-base  |                     76 MiB |
| High accuracy (Whisper Small) | onnx-community/whisper-small |                    240 MiB |
| Italian → English             | Xenova/opus-mt-it-en         |                    131 MiB |
| English → Italian             | Xenova/opus-mt-en-it         |                    130 MiB |

Runtime assets add about 22 MiB. These are multilingual Whisper variants. High accuracy needs substantially more working memory than its download size; use Fast on phones. WebGPU is preferred when an adapter is available; failed kernels fall back to WASM with a visible message. The first actual result on each GPU model is also compared with the same local WASM model before being saved; a differing result selects WASM. This adds startup time and temporary memory use. On the tested Mac, q8 GPU execution produced incorrect output despite loading successfully, and this verification selected the working WASM result. WASM is slower on some devices. Device selection can explicitly force WASM.

## Installation and offline use

Download buttons show a confirmation and the approximate size, and nothing is downloaded before a click. A file manifest pins repository commit IDs and expected byte lengths. Partial files are never accepted as complete. Completed files are retained after cancellation or failure, and retries reuse them. Per-model browser locks prevent concurrent duplicate downloads. Offline readiness checks every required model file and the separately cached runtime; browser eviction can make a model unavailable later. Check status or download to repair it. Removal deletes only the selected model (and its kept partial bytes), and leaves transcripts/audio alone.

The app itself must have finished its service worker installation before offline reload. Models and runtime are independent from saved study records. Request persistent storage in Settings and export study backups periodically.

## When a download fails ("Failed to fetch")

**What "Failed to fetch" means.** It is the browser's generic message when a request fails before the page may read any answer: the device is offline, DNS or a firewall/VPN/school filter/content blocker stops the connection, the connection resets, or the server answers with an error page that carries no CORS headers (some rate-limit and gateway errors). It does not say _which_ address failed.

**What was checked** (October 11, 2026):

| Check                                            | Result                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pinned URLs and manifests (`pnpm verify:models`) | Every file of all five models resolves at its pinned commit, with exactly the byte length in `assets/models.js`, readable cross-origin (CORS) from `https://3cn7.github.io`.                                                                                                                                                                           |
| CORS and hosting                                 | `huggingface.co` answers `/resolve/<commit>/<file>` with CORS for the requesting origin. Small files redirect within `huggingface.co`; large `.onnx` files redirect to a **different** download host (`us.aws.cdn.hf.co` today; the host has changed several times) that sends `access-control-allow-origin: *`, supports ranges and allows preflight. |
| Real downloads                                   | All five models installed through the real UI from the real files, in the app's built-in browser and in a fresh Chrome profile with the service worker controlling the page.                                                                                                                                                                           |
| Service worker                                   | It only handles same-origin files; model requests never pass through it, and its separate runtime cache is not involved in model downloads.                                                                                                                                                                                                            |
| Offline cache                                    | All five models loaded from Cache Storage with the network disabled, and ran (see timings below).                                                                                                                                                                                                                                                      |

**Cause.** From this Mac, with these pinned URLs, the failure could **not** be reproduced; the manifests, CORS and hosting are correct, so the defect is not in the model list. The failure _is_ reproduced deterministically when the host that serves the large files is unreachable: because Hugging Face serves small files from `huggingface.co` and large ones from a separate domain, a network, VPN, filter or blocker that permits one and not the other lets `config.json` succeed and then fails the first `.onnx` with exactly `TypeError: Failed to fetch` (the browser test `browser-model-recovery.mjs` does this). That, a dropped connection or a rate limit are the realistic causes on a learner's network. I could not test the learner's own network, so this is the likely cause, not a proven one.

**What changed so that failures are recoverable and understandable:**

- Network errors are retried up to four attempts with 1 s / 2 s / 4 s backoff (honouring `Retry-After` for HTTP 429/503); the row says "Retrying in 2 s (attempt 3 of 4)…".
- An interrupted transfer continues from the bytes already received (HTTP `Range`); a server that ignores ranges simply restarts that file. After a final failure or a cancel, the bytes received are kept in the model cache and a later attempt, even after a reload, continues from there.
- Errors are explained in plain language with the next step ("Could not reach huggingface.co or the download servers it hands large files to (hf.co)…", "You are offline…", HTTP 404/429/5xx wording). Finished files are never discarded.
- **Check connection** tries this site, the Hugging Face catalogue and the download servers separately and says which one is blocked.
- **Try again** only fetches what is missing.
- _Download address (advanced)_ in Settings → Downloaded models lets a learner whose network blocks Hugging Face point downloads at their own copy with the same folder layout (`<address>/<repo>/resolve/<commit>/<file>`, https, cross-origin readable). Files are still checked against the pinned byte lengths and cached under the pinned keys.
- `pnpm verify:models` re-checks the manifests against the live hosts.

## High accuracy (Whisper Small)

It is a normal, pinned, q8 multilingual model (`onnx-community/whisper-small`, 251,848,807 bytes = 240 MiB). Measured on this Mac with WebAssembly, one thread, on a 5.6 s English clip: Fast 1.9 s, Balanced 3.8 s, High accuracy 14.3 s. High accuracy therefore runs slower than real time: it is best for uploaded recordings, and the app says so; live recording keeps up only with Fast and usually with Balanced.

**Availability.** The dashboard and the Transcripts page offer _Download now_ (about 240 MB, once, with progress, cancel, retry and a header indicator while it runs). Nothing starts without that click; _Not now_ hides the offer for 14 days. The download continues while the learner uses the rest of the app, the model is then available offline, and requesting persistent storage at that moment reduces the chance that the browser evicts it. The default speech quality stays Fast, because High accuracy cannot keep up with live speech.

**Why it is not bundled in this repository or the Pages site.**

- _Size._ The decoder alone is 156,750,845 bytes (149 MiB). GitHub blocks files over 100 MiB in a repository ([About large files](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)), so it would need Git LFS or splitting; the whole model would also count toward the recommended 1 GB repository size.
- _Hosting._ Published Pages sites may be no larger than 1 GB and have a soft 100 GB/month bandwidth limit ([GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)). Every first-time user downloads 240 MiB, so a few hundred first downloads a month would approach that limit, and Hugging Face's CDN is built for this traffic.
- _Licensing._ The ONNX conversion repositories carry no licence field themselves; their upstream models are tagged Apache-2.0 on Hugging Face (`openai/whisper-small`, and `Helsinki-NLP/opus-mt-it-en` / `opus-mt-en-it`). Redistribution would need the notices that go with that licence and a check of each conversion. Downloading from Hugging Face directly to each learner's own browser avoids redistributing the weights from this site. This is a reading of the published metadata, not legal advice.

If Hugging Face is unacceptable for some deployment, host the five folders yourself (Cloudflare R2, S3, a university server or a GitHub Release split into chunks) and enter that address under _Download address_.

## Recognition

Microphone input uses getUserMedia, Web Audio and an AudioWorklet. A dedicated worker processes chronological, non-overlapping 8-second chunks at 16 kHz. Pause flushes a short remaining chunk; Stop drains pending work. Cancellation terminates inference workers while retaining finalized text. A bounded backlog pauses capture rather than dropping queued speech.

Fast/auto/mixed detection uses Whisper's first decoder language logits, comparing the English and Italian language tokens per chunk. This is necessary because this library version otherwise defaults to English. The chosen language is explicitly passed with task=transcribe. Sentence language assignment combines that result with a small English/Italian text heuristic. Detection can be wrong, especially if languages switch inside one short chunk: review and correct segment languages. No confidence percentage is fabricated.

Stop recording before closing the page to retain its raw audio; finalized text is already saved incrementally. Refresh cannot recover audio still held in memory.

Timestamps are model segment times; sentence subdivisions use approximate proportional boundaries. Microphone recording time excludes pauses. Text edits retain original recognition and a bounded edit history. Recovered draft text remains visible after refresh.

Short uploads decode locally, downmix and resample before worker processing. Longer files stream through the browser codec decoder at playback speed to bound PCM memory, with automatic catch-up pauses. Codec support depends on the browser; WAV and MP3 are the safest conversions if M4A/WebM/MP4 fail. Limits prevent excessive memory/storage use; split longer recordings. Audio never leaves the device through the inference pipeline or Drive adapter.

## Translation

A separate worker translates finalized segments incrementally, Italian to English or English to Italian. It loads only the needed direction. Completed matching source/language/target signatures are not translated again. Source text and original recognition are retained; manual translation edits take precedence over an in-flight model response. Segments already in the target language are retained as-is. Uncertain languages need correction. Pending translations drain after recording stops; Pause/Resume/Stop translation are separate controls.

## Sources researched

[Transformers.js repository](https://github.com/huggingface/transformers.js), [stable WebGPU guide](https://huggingface.co/docs/transformers.js/v3.8.1/en/guides/webgpu), [real-time Whisper demo](https://huggingface.co/spaces/Xenova/realtime-whisper-webgpu), [Whisper base](https://huggingface.co/onnx-community/whisper-base), [Italian–English OPUS](https://huggingface.co/Xenova/opus-mt-it-en), [English–Italian OPUS](https://huggingface.co/Xenova/opus-mt-en-it). Implementation was also checked against the installed library source rather than assuming every documented auto-detection option was implemented.
