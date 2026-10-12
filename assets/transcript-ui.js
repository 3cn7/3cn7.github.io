import { id, now, record, createStudySet, createFlashcard } from "./core.js";
import {
  $,
  esc,
  attr,
  options,
  button,
  field,
  selectField,
  modal,
  toast,
  empty,
  download,
  date,
  duration,
  confirmAction,
} from "./ui.js";
import { MODELS } from "./models.js";
import { ModelManager, readModelHost, saveModelHost } from "./model-manager.js";
import {
  InferenceClient,
  finalizeSegments,
  localCardDrafts,
} from "./transcription.js";
import {
  Microphone,
  decodeAudio,
  audioDuration,
  FileCapture,
} from "./audio.js";
export function createTranscriptUI(ctx) {
  const { store } = ctx,
    manager = new ModelManager(),
    asr = new InferenceClient(),
    translator = new InferenceClient();
  let selectedId = null,
    jobId = null,
    mic = null,
    recorder = null,
    recorded = [],
    recordedBytes = 0,
    recordAudioId = null,
    audioURL = null;
  let fileMode = false,
    autoPaused = false,
    starting = false,
    capturing = false,
    paused = false,
    cancelled = false,
    queue = [],
    transQueue = [],
    running = false,
    transRunning = false,
    translationPaused = false;
  let pcm = new Float32Array(0),
    sampleOffset = 0,
    totalSamples = 0,
    doneChunks = 0,
    uploadTotal = 0,
    captureError = "",
    device = "Not loaded",
    editTimer = null,
    captureMode = "record",
    selectedFile = null,
    installing = false,
    setupCancelled = false,
    setupKeys = [],
    setupError = "",
    modelCacheAvailable = true,
    searchPosition = null;
  let settings = {
    quality: "fast",
    source: "auto",
    target: "en",
    translate: false,
    display: "both",
    device: "auto",
    ...store.get("study-preferences")?.transcription,
  };
  const size = (m) => (m.bytes / 1024 / 1024).toFixed(0) + " MB";
  const modelName = (m) =>
    ({
      fast: "Fast speech",
      balanced: "Balanced speech",
      high: "High accuracy speech",
      "it-en": "Italian → English",
      "en-it": "English → Italian",
    })[m.key];
  const languageName = (lang) => (lang === "it" ? "Italian" : "English");
  const translationStatus = (s) =>
    ({
      done: "Translated",
      same_language: "Already " + languageName(s.targetLanguage),
      processing: "Translating…",
      edited: "Edited",
      not_requested: "Not translated",
      unknown_language: "Choose a language",
      error: "Translation failed",
      cancelled: "Stopped",
      needs_update: "Needs updating",
    })[s.translationStatus] || "Not translated";
  function requiredKeys() {
    return [
      settings.quality,
      ...(settings.translate
        ? [settings.target === "en" ? "it-en" : "en-it"]
        : []),
    ];
  }
  const ready = () =>
    modelCacheAvailable &&
    requiredKeys().every((key) => manager.states.get(key)?.offline);
  function setupView() {
    if (!modelCacheAvailable)
      return '<p class="notice error">Recording needs browser storage. Open this page in Chrome, Edge, or Safari using HTTPS or localhost.</p>';
    const missing = requiredKeys().filter(
      (key) => !manager.states.get(key)?.offline,
    );
    if (
      installing ||
      requiredKeys().some(
        (key) => manager.states.get(key)?.state === "DOWNLOADING",
      )
    ) {
      const keys = installing ? setupKeys : requiredKeys();
      const bytes = keys.reduce(
        (n, key) => n + MODELS.find((m) => m.key === key).bytes,
        0,
      );
      const completed = keys.reduce((n, key) => {
        const state = manager.states.get(key) || {};
        return (
          n +
          MODELS.find((m) => m.key === key).bytes *
            (state.offline ? 1 : (state.progress || 0) / 100)
        );
      }, 0);
      const progress = Math.min(100, Math.round((completed / bytes) * 100));
      return `<div class="setup-copy"><strong>Downloading files · ${progress}%</strong><div class="progress" role="progressbar" aria-label="Setup download" aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="100"><div style="width:${progress}%"></div></div></div>${button("Cancel download", "cancel-setup", "", "small")}`;
    }
    if (!missing.length)
      return '<span class="ready-label"><span class="status-dot"></span>Ready offline</span>';
    const bytes = missing.reduce(
      (n, key) =>
        n +
        MODELS.find((m) => m.key === key).bytes -
        (manager.states.get(key)?.bytes || 0),
      0,
    );
    return `<div class="setup-copy"><strong>One-time setup</strong><small>${missing.map((key) => modelName(MODELS.find((m) => m.key === key))).join(" + ")} · about ${Math.ceil(bytes / 1024 / 1024)} MB${missing.some((key) => manager.states.get(key)?.runtimeMissing?.length) ? " + 22 MB processing files" : ""}</small>${setupError ? `<small class="notice error" role="alert">${esc(setupError)}</small>` : ""}</div><div class="row">${setupError ? button("Check connection", "diagnose-model", `data-key="${attr(missing[0] || settings.quality)}"`, "small") : ""}${button(setupError ? "Try again" : "Download files", "download-required", "", "primary")}</div>`;
  }
  function updateSetup() {
    const setup = $("#captureSetup");
    if (setup) {
      setup.innerHTML = setupView();
      setup.classList.toggle("is-ready", ready() && !installing);
    }
    document
      .querySelectorAll("[data-model-row] .model-main button")
      .forEach((button) => {
        button.disabled =
          installing ||
          (busy() && !!manager.states.get(button.dataset.key)?.offline);
      });
    updateStatus();
  }
  const textOf = (t) =>
    t.segments?.length
      ? t.segments.map((s) => s.text ?? s.originalText).join("\n")
      : (t.editedText ?? t.rawText ?? "");
  const translatedOf = (t) =>
    (t.segments || [])
      .map((s) => s.translatedText || "")
      .filter(Boolean)
      .join("\n");
  const busy = () =>
    starting ||
    capturing ||
    running ||
    queue.length > 0 ||
    transRunning ||
    transQueue.length > 0;
  async function modelView() {
    let states = [];
    try {
      states = await manager.all();
    } catch {
      modelCacheAvailable = false;
      return '<div class="notice error">Downloads need browser storage on HTTPS or localhost.</div>';
    }
    const usage = await navigator.storage?.estimate();
    return `<div class="model-list">${MODELS.map((m) =>
      modelRow(
        m,
        states.find((s) => s.key === m.key),
      ),
    ).join(
      "",
    )}</div><small class="storage-note">${usage?.usage ? (usage.usage / 1024 / 1024).toFixed(0) + " MB stored" : "Storage usage unavailable"}${usage?.quota ? " · " + (usage.quota / 1024 / 1024 / 1024).toFixed(1) + " GB available to this site" : ""}. Your browser may clear unused files.</small><details class="model-source"><summary>Download address (advanced)</summary><p class="muted">Models are fetched from huggingface.co at fixed, pinned versions and checked against their exact file sizes. If your network blocks Hugging Face, you can point this at your own copy that uses the same folder layout (<code>/&lt;repo&gt;/resolve/&lt;revision&gt;/&lt;file&gt;</code>) and allows cross-origin reads.</p><label>Download from<input id="modelHost" type="url" inputmode="url" placeholder="https://huggingface.co (default)" value="${attr(readModelHost())}" autocomplete="off"></label><div class="row">${button("Save address", "save-model-host", "", "small")}${button("Use Hugging Face", "reset-model-host", "", "small")}</div></details>`;
  }
  function modelRow(m, s = {}) {
    const label =
      s.state === "DOWNLOADING"
        ? "Downloading…"
        : s.state === "LOADING"
          ? "Loading…"
          : s.offline
            ? "Ready offline"
            : s.state === "ERROR"
              ? "Download failed"
              : "Not downloaded";
    const expanded = document.querySelector(
      `[data-model-row="${m.key}"] details`,
    )?.open;
    return `<div class="model-row" data-model-row="${m.key}" data-state="${s.state || "NOT_INSTALLED"}"><div class="model-main"><div><strong>${esc(modelName(m))}</strong><div class="model-detail">${size(m)} · ${label}</div></div>${button(s.state === "DOWNLOADING" ? "Cancel" : s.offline ? "Remove" : s.state === "ERROR" ? "Try again" : "Download", s.state === "DOWNLOADING" ? "cancel-model" : s.offline ? "remove-model" : "download-model", `data-key="${m.key}" ${installing || (busy() && s.offline) ? "disabled" : ""}`, "small")}</div>${s.state === "DOWNLOADING" ? `<div class="progress" role="progressbar" aria-label="${attr(modelName(m))} download" aria-valuenow="${Math.round(s.progress || 0)}" aria-valuemin="0" aria-valuemax="100"><div style="width:${s.progress || 0}%"></div></div><small class="model-note" role="status">${esc(s.note || (s.progress ? Math.round(s.progress) + "% · " + (s.file || "").split("/").pop() : "Starting…"))}</small>` : ""}${s.error && s.state !== "DOWNLOADING" ? `<div class="notice error" role="alert"><p>${esc(s.error)}</p>${s.code && !["STORAGE", "CANCELLED"].includes(s.code) ? button("Check connection", "diagnose-model", `data-key="${m.key}"`, "small") : ""}</div>` : ""}<details ${expanded ? "open" : ""}><summary>Details</summary><small>${esc(m.label)} · ${esc(m.id)}</small>${button("Check status", "check-model", `data-key="${m.key}"`, "small")}</details></div>`;
  }
  manager.addEventListener("status", (e) => {
    document.querySelectorAll(`[data-model-row="${e.detail.key}"]`).forEach(
      (row) =>
        (row.outerHTML = modelRow(
          MODELS.find((m) => m.key === e.detail.key),
          e.detail,
        )),
    );
    updateSetup();
    updateOffer();
  });
  for (const client of [asr, translator])
    client.addEventListener("fallback", (e) => {
      device = "WebAssembly";
      toast(e.detail.message);
      updateStatus();
    });
  // Offer to keep the High accuracy model on the device (never downloaded without a click).
  const OFFER_KEY = "studyPlatform.highOfferHiddenUntil";
  const offerHidden = () => {
    try {
      return Number(localStorage.getItem(OFFER_KEY)) > Date.now();
    } catch {
      return false;
    }
  };
  function offerHTML() {
    const m = MODELS.find((m) => m.key === "high"),
      s = manager.states.get("high") || {};
    if (!modelCacheAvailable || s.offline) return "";
    if (s.state === "DOWNLOADING")
      return `<div class="notice model-offer" id="highOffer" role="status"><div class="offer-copy"><strong>Downloading High accuracy speech · ${Math.round(s.progress || 0)}%</strong><div class="progress" role="progressbar" aria-label="High accuracy download" aria-valuenow="${Math.round(s.progress || 0)}" aria-valuemin="0" aria-valuemax="100"><div style="width:${s.progress || 0}%"></div></div><small>${esc(s.note || "You can keep using Studyroom; the download continues.")}</small></div>${button("Cancel", "cancel-model", 'data-key="high"', "small")}</div>`;
    if (s.state === "ERROR" && s.error)
      return `<div class="notice error model-offer" id="highOffer" role="alert"><div class="offer-copy"><strong>High accuracy speech did not finish downloading</strong><small>${esc(s.error)}</small></div><div class="row">${button("Check connection", "diagnose-model", 'data-key="high"', "small")}${button("Try again", "offer-high", "", "small primary")}</div></div>`;
    if (offerHidden()) return "";
    return `<div class="notice model-offer" id="highOffer"><div class="offer-copy"><strong>Get High accuracy speech ready</strong><small>The most accurate transcription option (Whisper Small, about ${size(m)}), best for uploaded recordings because it runs slower than live speech. It is downloaded once from Hugging Face, kept on this device and works offline afterwards. Nothing is downloaded until you choose.</small></div><div class="row">${button("Download now", "offer-high", "", "small primary")}${button("Not now", "dismiss-high", "", "small")}</div></div>`;
  }
  function updateOffer() {
    document.querySelectorAll("#highOffer").forEach((node) => {
      const html = offerHTML();
      if (html) node.outerHTML = html;
      else node.remove();
    });
    const chip = $("#modelChip"),
      busyKeys = MODELS.filter(
        (m) => manager.states.get(m.key)?.state === "DOWNLOADING",
      );
    if (chip) {
      chip.hidden = !busyKeys.length;
      if (busyKeys.length) {
        const m = busyKeys[0];
        chip.textContent = `⬇️ ${modelName(m)} ${Math.round(manager.states.get(m.key).progress || 0)}%`;
      }
    }
  }
  async function prepare() {
    try {
      await manager.all();
    } catch {
      modelCacheAvailable = false;
    }
    updateOffer();
  }
  async function requireModel(key) {
    const status = await manager.status(key);
    if (!status.offline)
      throw new Error(
        "Download " +
          MODELS.find((m) => m.key === key).label +
          ". Choose Download files before starting.",
      );
  }
  async function loadSpeech() {
    await requireModel(settings.quality);
    manager.emit(settings.quality, "LOADING");
    updateStatus("Loading speech model…");
    try {
      const result = await asr.run("load", {
        key: settings.quality,
        device: settings.device,
      });
      device = result.device === "webgpu" ? "WebGPU" : "WebAssembly";
      await manager.status(settings.quality);
    } catch (e) {
      manager.emit(settings.quality, "ERROR", { error: e.message });
      throw e;
    }
  }
  async function saveSettings() {
    const value = { ...settings };
    await store.change(
      "Transcription settings",
      (rows) => {
        const current = rows.find((r) => r.id === "study-preferences") || {
          ...record("preferences"),
          id: "study-preferences",
        };
        return [
          ...rows.filter((r) => r.id !== "study-preferences"),
          { ...current, transcription: value },
        ];
      },
      { undo: false },
    );
  }
  function readSettings() {
    const form = $("#captureSettings");
    if (!form) return;
    const fd = new FormData(form);
    settings = {
      ...settings,
      quality: fd.get("quality") || settings.quality,
      source: fd.get("source") || settings.source,
      target: fd.get("target") || settings.target,
      translate: fd.has("translate"),
      display: fd.get("display") || settings.display,
      device: fd.get("device") || settings.device,
    };
  }
  function captureForm(models) {
    return `<section class="panel capture-bar" aria-label="Add a recording"><div class="row between"><h2 class="transcript-title">New transcript</h2><small>Audio stays on this device</small></div>
      <div class="capture-modes" role="group" aria-label="Recording source">${button("Record", "capture-mode", `data-mode="record" aria-pressed="${captureMode === "record"}"`)}${button("Upload audio", "capture-mode", `data-mode="upload" aria-pressed="${captureMode === "upload"}"`)}</div>
      <form id="captureSettings" class="stack"><div class="capture-options">${selectField(
        "Spoken language",
        "source",
        [
          ["auto", "Auto detect"],
          ["en", "English"],
          ["it", "Italian"],
          ["mixed", "English + Italian"],
        ],
        settings.source,
      )}<label class="check"><input name="translate" type="checkbox" ${settings.translate ? "checked" : ""}>Live translation</label><div id="translationTarget" ${settings.translate ? "" : "hidden"}>${selectField(
        "Translate into",
        "target",
        [
          ["en", "English"],
          ["it", "Italian"],
        ],
        settings.target,
      )}</div></div>
      <details class="capture-advanced"><summary>Quality & processing</summary><div class="form-grid">${selectField(
        "Speech quality",
        "quality",
        MODELS.filter((m) => m.task === "automatic-speech-recognition").map(
          (m) => [m.key, modelName(m) + " · " + size(m)],
        ),
        settings.quality,
      )}${selectField(
        "Processing device",
        "device",
        [
          ["auto", "Automatic"],
          ["wasm", "CPU"],
        ],
        settings.device,
      )}</div><small>Text appears in roughly 8-second sections. Fast keeps up with live speech. Balanced and High accuracy are more accurate but slower; High accuracy usually falls behind live speech, so it suits uploaded recordings best.</small><small id="captureDevice">${device === "Not loaded" ? "" : "Using " + device}</small></details></form>
      <div id="captureSetup" class="capture-setup ${ready() && !installing ? "is-ready" : ""}">${setupView()}</div>
      <div id="recordPanel" ${captureMode === "record" ? "" : "hidden"}><div class="capture-actions">${button("Start recording", "start-recording", "", "primary")}${button(paused ? "Resume" : "Pause", "pause-recording", capturing ? "" : "hidden")}${button("Stop", "stop-recording", capturing ? "" : "hidden")}</div></div>
      <div id="uploadPanel" ${captureMode === "upload" ? "" : "hidden"}><div class="file-picker" id="audioDropZone"><label for="audioInput">Choose an audio file</label><input id="audioInput" type="file" accept="audio/*,video/mp4,video/webm"><span class="file-choice" id="audioFileName" role="status">${selectedFile ? esc(selectedFile.name) : "or drop a file here"}</span><small>MP3, M4A, WAV, WebM, MP4 · up to one hour</small><div class="row">${button("Transcribe file", "transcribe-file", "", "primary")}${button("Clear file", "clear-audio-file", selectedFile ? "" : "hidden", "small")}</div></div></div>
      <div class="capture-status" role="status"><span id="captureState">Ready</span><span id="captureElapsed" hidden>0m 0s</span><span id="captureBacklog" hidden></span>${button("Cancel processing", "cancel-processing", busy() ? "" : "hidden", "small")}</div>${captureError ? `<div class="notice error" id="captureError" role="alert">${esc(captureError)}</div>` : ""}
      <details class="downloaded-models"><summary>Manage downloaded models</summary>${models}</details></section>`;
  }
  async function view(transcriptId) {
    selectedId = transcriptId || jobId;
    const t = selectedId ? store.get(selectedId) : null;
    if (audioURL) {
      URL.revokeObjectURL(audioURL);
      audioURL = null;
    }
    if (t?.audioId) {
      const saved = await store.audio(t.audioId);
      if (saved?.blob) audioURL = URL.createObjectURL(saved.blob);
    }
    const models = await modelView();
    return `<div class="page-head"><h1>Transcripts</h1>${button("Create cards from notes", "cards-from-notes")}</div><div class="transcription-workspace">${offerHTML()}${captureForm(models)}${t ? transcriptView(t) : ""}
      <section class="panel saved-transcripts"><div class="row between"><h2>Saved transcripts</h2>${t ? button("New recording", "new-transcript", "", "small") : ""}</div>${
        store
          .list("transcript")
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .map(
            (saved) =>
              `<div class="transcript-list-row ${saved.id === selectedId ? "is-selected" : ""}"><a href="#transcripts/${attr(saved.id)}"><strong>${esc(saved.title)}</strong><small>${date(saved.updatedAt)}</small></a>${button("×", "delete-transcript", `data-id="${attr(saved.id)}" aria-label="Delete ${attr(saved.title)}" title="Delete transcript"`, "icon-btn")}</div>`,
          )
          .join("") ||
        '<p class="muted transcript-list-empty">No transcripts yet.</p>'
      }</section></div>`;
  }
  function transcriptView(t) {
    const hasSegments = t.segments?.length;
    const waitingForSpeech =
      !hasSegments &&
      t.provider === "browser-local" &&
      !t.rawText &&
      !t.editedText;
    const hasTranslation =
      settings.translate ||
      t.segments?.some((s) => s.translatedText || s.targetLanguage);
    return `<section class="transcript-editor stack" aria-label="Transcript editor"><div class="row between"><div><h2>${esc(t.title)}</h2><small>Saved · ${date(t.updatedAt)}</small></div><div class="row">${button("Create flashcards", "draft-cards", `data-id="${t.id}"`, "primary")}<details class="action-menu"><summary>More</summary><div>${button("Rename", "rename-transcript", `data-id="${t.id}"`)}${button("Move to folder…", "move-transcript", `data-id="${t.id}"`)}${button("Export", "export-transcript", `data-id="${t.id}"`)}${button("Copy original", "copy-transcript", `data-id="${t.id}"`)}${button("Copy translation", "copy-translation", `data-id="${t.id}"`)}${button("Translate saved segments", "translate-saved", `data-id="${t.id}"`)}${button(translationPaused ? "Resume translation" : "Pause translation", "pause-translation")}${button("Stop translation", "stop-translation")}${audioURL ? button("Delete local audio…", "delete-audio", `data-id="${t.id}"`, "danger") : ""}</div></details></div></div>
      ${audioURL ? `<audio class="audio-player" id="transcriptAudio" controls src="${audioURL}"></audio>` : ""}
      <div class="toolbar transcript-toolbar"><input type="search" id="transcriptSearch" aria-label="Search transcript" placeholder="Search transcript">${button("Find next", "find-transcript")}<label class="transcript-display" ${hasSegments && hasTranslation ? "" : "hidden"}>View<select id="transcriptDisplay" aria-label="Transcript view">${options(
        [
          ["both", "Original + translation"],
          ["original", "Original only"],
          ["translated", "Translation only"],
        ],
        settings.display,
      )}</select></label></div>
      <div id="liveSegments" class="stack">${hasSegments ? t.segments.map((s) => segmentPair(s, t.id)).join("") : waitingForSpeech ? `<div class="empty" data-awaiting-speech>${capturing ? "Listening…" : "Transcribing…"}</div>` : `<label>Transcript<textarea id="editedTranscript" class="transcript-text" data-id="${t.id}">${esc(t.editedText ?? t.rawText ?? "")}</textarea></label>`}</div>
      <div class="row"><small id="transcriptSaveStatus">Changes save automatically</small>${button("Save transcript", "save-transcript", `data-id="${t.id}"`, "small")}</div>
      <details class="transcript-history"><summary>Original text & edit history</summary><pre>${esc(t.rawText || "No speech recognized yet.")}</pre>${(
        t.editHistory || []
      )
        .slice(-10)
        .reverse()
        .map(
          (h) =>
            `<details><summary>${date(h.at)}</summary><pre>${esc(h.text)}</pre></details>`,
        )
        .join(
          "",
        )}</details>${t.generatedNotes ? `<details><summary>Saved study notes</summary><pre>${esc(t.generatedNotes)}</pre></details>` : ""}</section>`;
  }
  function segmentPair(s, tid) {
    const original = s.text ?? s.originalText ?? "",
      display =
        !settings.translate && !s.translatedText && !s.targetLanguage
          ? "original"
          : settings.display;
    return `<div class="segment-pair ${display !== "both" ? "single" : ""}" data-segment-pair="${s.id}" id="segment-${attr(s.id)}">${
      display !== "translated"
        ? `<article class="segment-card"><div class="segment-header"><button data-action="seek-audio" data-time="${s.start || 0}" aria-label="Seek to ${s.start || 0} seconds">${duration((s.start || 0) * 1000)}</button><label class="sr-only" for="lang-${s.id}">Segment language</label><select id="lang-${s.id}" data-segment-language="${s.id}" data-transcript="${tid}" aria-label="Segment language">${options(
            [
              ["unknown", "Uncertain · choose language"],
              ["it", "Italian"],
              ["en", "English"],
            ],
            s.sourceLanguage || "unknown",
          )}</select></div><label>Original<textarea data-segment-edit="${s.id}" data-transcript="${tid}" data-field="text">${esc(original)}</textarea></label></article>`
        : ""
    }${display !== "original" ? `<article class="segment-card"><div class="segment-header"><span class="badge">${languageName(s.targetLanguage)}</span><small data-translation-status="${s.id}">${esc(translationStatus(s))}</small></div><label>Translation<textarea data-segment-edit="${s.id}" data-transcript="${tid}" data-field="translatedText" placeholder="${s.translationStatus === "unknown_language" ? "Choose the source language to translate." : "Translation appears here."}">${esc(s.translatedText || "")}</textarea></label>${s.translationError ? `<small class="notice error">${esc(s.translationError)}</small>` : ""}</article>` : ""}</div>`;
  }
  function updateStatus(note) {
    const state = $("#captureState");
    if (state)
      state.innerHTML = capturing
        ? `<span class="recording-dot"></span>${paused ? "Paused" : fileMode ? "Processing file" : "Recording"}`
        : note
          ? esc(note)
          : running || queue.length
            ? "Transcribing…"
            : captureError
              ? esc(captureError)
              : doneChunks
                ? "Saved"
                : ready()
                  ? "Ready"
                  : "Download files to begin";
    const elapsed = $("#captureElapsed");
    if (elapsed) {
      elapsed.textContent = duration(totalSamples / 16);
      elapsed.hidden = !totalSamples && !capturing;
    }
    const backlog = $("#captureBacklog");
    if (backlog) {
      const speech = queue.length + (running ? 1 : 0),
        translation = transQueue.length + (transRunning ? 1 : 0);
      backlog.dataset.speech = speech;
      backlog.dataset.translation = translation;
      backlog.textContent = uploadTotal
        ? `${Math.min(100, Math.round((doneChunks / uploadTotal) * 100))}% complete${translation ? " · translating" : ""}`
        : `${speech + translation} ${speech + translation === 1 ? "section" : "sections"} pending`;
      backlog.hidden = !(speech || translation || uploadTotal);
    }
    const processingDevice = $("#captureDevice");
    if (processingDevice)
      processingDevice.textContent =
        device === "Not loaded" ? "" : "Using " + device;
    for (const [action, disabled] of [
      ["start-recording", busy() || installing || !ready()],
      ["pause-recording", !capturing],
      ["stop-recording", !capturing],
      ["cancel-processing", !busy()],
      [
        "transcribe-file",
        busy() ||
          installing ||
          !ready() ||
          (!selectedFile && !$("#audioInput")?.files.length),
      ],
    ]) {
      const el = document.querySelector(`[data-action="${action}"]`);
      if (el) el.disabled = !!disabled;
    }
    for (const action of [
      "pause-recording",
      "stop-recording",
      "cancel-processing",
    ]) {
      const el = document.querySelector(`[data-action="${action}"]`);
      if (el) el.hidden = action === "cancel-processing" ? !busy() : !capturing;
    }
    const recordPanel = $("#recordPanel");
    if (recordPanel)
      recordPanel.hidden = captureMode !== "record" && !capturing;
    const fileInput = $("#audioInput");
    if (fileInput) fileInput.disabled = busy() || installing;
    document
      .querySelectorAll('[data-action="capture-mode"]')
      .forEach((el) => (el.disabled = busy()));
    for (const name of ["source", "quality", "device"]) {
      const input = document.querySelector(
        "#captureSettings [name=" + name + "]",
      );
      if (input)
        input.disabled =
          starting || capturing || running || queue.length > 0 || installing;
    }
    for (const name of ["translate", "target"]) {
      const input = document.querySelector(`#captureSettings [name="${name}"]`);
      if (input) input.disabled = installing;
    }
    const pause = document.querySelector('[data-action="pause-recording"]');
    if (pause) pause.textContent = paused ? "Resume" : "Pause";
  }
  async function begin(title) {
    cancelled = false;
    captureError = "";
    queue = [];
    pcm = new Float32Array(0);
    sampleOffset = 0;
    totalSamples = 0;
    doneChunks = 0;
    uploadTotal = 0;
    await loadSpeech();
    if (settings.translate)
      await requireModel(settings.target === "en" ? "it-en" : "en-it");
    await saveSettings();
    const t = record("transcript", {
      title: title || "Class notes",
      language: settings.source,
      provider: "browser-local",
      model: MODELS.find((m) => m.key === settings.quality).id,
      modelRevision: MODELS.find((m) => m.key === settings.quality).revision,
      rawText: "",
      editedText: "",
      segments: [],
      editHistory: [],
      audioId: null,
    });
    await store.put(t);
    jobId = t.id;
    selectedId = t.id;
    return t;
  }
  function pushSamples(samples) {
    if (cancelled) return;
    totalSamples += samples.length;
    const combined = new Float32Array(pcm.length + samples.length);
    combined.set(pcm);
    combined.set(samples, pcm.length);
    pcm = combined;
    while (pcm.length >= 128000) {
      queue.push({
        samples: pcm.slice(0, 128000),
        start: sampleOffset / 16000,
        length: 8,
        id: jobId,
        hint: settings.source,
      });
      sampleOffset += 128000;
      pcm = pcm.slice(128000);
    }
    if (queue.length >= 15 && capturing && !paused) {
      paused = true;
      autoPaused = fileMode;
      mic.pause();
      recorder?.pause();
      captureError =
        "Processing is falling behind. Recording paused so no queued speech is lost. Resume when the backlog clears.";
      toast(captureError);
    }
    updateStatus();
    processSpeech();
  }
  function flush() {
    if (pcm.length >= 1600) {
      queue.push({
        samples: pcm,
        start: sampleOffset / 16000,
        length: pcm.length / 16000,
        id: jobId,
        hint: settings.source,
      });
      sampleOffset += pcm.length;
    }
    pcm = new Float32Array(0);
    processSpeech();
  }
  async function processSpeech() {
    if (running || cancelled) return;
    running = true;
    try {
      while (queue.length && !cancelled) {
        const item = queue.shift();
        updateStatus();
        const result = await asr.run("transcribe", {
          key: settings.quality,
          device: settings.device,
          samples: item.samples,
          language: item.hint,
        });
        if (cancelled) break;
        const segments = finalizeSegments(
          result,
          item.start,
          item.length,
          item.hint,
        );
        await store.update(
          item.id,
          (t) => {
            if (t.deleted) return t;
            const known = new Set(t.segments.map((s) => s.id));
            const joined = [
              ...t.segments,
              ...segments.filter((s) => !known.has(s.id)),
            ].sort((a, b) => a.start - b.start);
            return {
              ...t,
              segments: joined,
              rawText: [t.rawText, ...segments.map((s) => s.originalText)]
                .filter(Boolean)
                .join("\n"),
              editedText: joined.map((s) => s.text).join("\n"),
            };
          },
          { undo: false },
        );
        doneChunks++;
        if (autoPaused && queue.length < 2) {
          autoPaused = false;
          paused = false;
          await mic.resume();
        }
        for (const segment of segments)
          if (settings.translate) enqueueTranslation(item.id, segment.id);
        refreshSegments();
        updateStatus();
      }
    } catch (e) {
      if (e.name !== "AbortError") {
        captureError = e.message;
        toast(e.message);
        if (capturing) await stopRecording();
        queue = [];
      }
    } finally {
      running = false;
      updateStatus();
    }
  }
  function enqueueTranslation(tid, sid) {
    if (transQueue.some((q) => q.tid === tid && q.sid === sid)) return;
    const segment = store.get(tid)?.segments?.find((s) => s.id === sid);
    if (!segment) return;
    const signature =
      (segment.text ?? segment.originalText) +
      "|" +
      segment.sourceLanguage +
      "|" +
      settings.target;
    if (
      segment.translationSignature === signature &&
      ["done", "same_language"].includes(segment.translationStatus)
    )
      return;
    transQueue.push({
      tid,
      sid,
      target: settings.target,
      signature,
      text: segment.text ?? segment.originalText,
      source: segment.sourceLanguage,
    });
    processTranslation();
  }
  async function processTranslation() {
    if (transRunning || translationPaused) return;
    transRunning = true;
    try {
      while (transQueue.length && !translationPaused) {
        const item = transQueue.shift();
        updateStatus();
        let translated = "",
          status = "done",
          error = "";
        try {
          if (item.source === item.target) {
            translated = item.text;
            status = "same_language";
          } else if (!["it", "en"].includes(item.source)) {
            status = "unknown_language";
          } else {
            const key = item.source === "it" ? "it-en" : "en-it";
            await requireModel(key);
            await markTranslation(item, "processing");
            const out = await translator.run("translate", {
              key,
              text: item.text,
              device: settings.device,
            });
            translated = out.text;
          }
        } catch (e) {
          status = e.name === "AbortError" ? "cancelled" : "error";
          error = e.name === "AbortError" ? "" : e.message;
        }
        await markTranslation(item, status, {
          translatedText: translated,
          translationError: error,
        });
        refreshSegments();
        updateStatus();
      }
    } finally {
      transRunning = false;
      updateStatus();
    }
  }
  async function markTranslation(item, status, extra = {}) {
    await store.update(
      item.tid,
      (t) => ({
        ...t,
        segments: t.segments.map((s) => {
          const signature =
            (s.text ?? s.originalText) +
            "|" +
            s.sourceLanguage +
            "|" +
            item.target;
          if (
            s.id !== item.sid ||
            signature !== item.signature ||
            s.translationStatus === "edited"
          )
            return s;
          return {
            ...s,
            ...extra,
            targetLanguage: item.target,
            translationStatus: status,
            translationSignature: item.signature,
          };
        }),
      }),
      { undo: false },
    );
  }
  function refreshSegments() {
    const t = store.get(selectedId),
      container = $("#liveSegments");
    if (!t || !container) return;
    if (t.segments?.length)
      container.querySelector("[data-awaiting-speech]")?.remove();
    for (const s of t.segments || []) {
      const row = container.querySelector(`[data-segment-pair="${s.id}"]`);
      if (!row) {
        container.insertAdjacentHTML("beforeend", segmentPair(s, t.id));
        continue;
      }
      if (
        (settings.translate || s.translatedText || s.targetLanguage) &&
        settings.display !== "original" &&
        !row.querySelector('[data-field="translatedText"]')
      ) {
        row.outerHTML = segmentPair(s, t.id);
        continue;
      }
      const text = row.querySelector('[data-field="translatedText"]');
      if (
        text &&
        text !== document.activeElement &&
        !localStorage.getItem("studyPlatform.segmentDraft." + t.id + "." + s.id)
      )
        text.value = s.translatedText || "";
      const status = row.querySelector("[data-translation-status]");
      if (status) status.textContent = translationStatus(s);
      const label = row.querySelector(".segment-header .badge");
      if (label) label.textContent = languageName(s.targetLanguage);
    }
    const display = $("#transcriptDisplay")?.closest("label");
    if (display)
      display.hidden =
        !settings.translate &&
        !t.segments?.some((s) => s.translatedText || s.targetLanguage);
    bindEditors();
  }
  async function startRecording() {
    if (busy()) return;
    starting = true;
    fileMode = false;
    updateStatus("Loading speech model…");
    readSettings();
    try {
      await begin("Class notes · " + new Date().toLocaleDateString());
      recordAudioId = id();
      recorded = [];
      recordedBytes = 0;
      mic = new Microphone(pushSamples);
      await mic.start();
      capturing = true;
      paused = false;
      if (globalThis.MediaRecorder) {
        recorder = new MediaRecorder(mic.stream);
        recorder.ondataavailable = (e) => {
          if (e.data.size) {
            recorded.push(e.data);
            recordedBytes += e.data.size;
            if (recordedBytes > 100 * 1024 * 1024 && capturing) {
              toast(
                "The recording reached the local size limit. Start a new recording to continue.",
              );
              stopRecording();
            }
          }
        };
        recorder.start(10000);
      }
      await ctx.render();
      updateStatus();
    } catch (e) {
      captureError = e.message;
      await mic?.stop();
      await ctx.render();
      throw e;
    } finally {
      starting = false;
      updateStatus();
    }
  }
  async function stopRecording() {
    if (!capturing) return;
    capturing = false;
    paused = false;
    await mic?.stop();
    flush();
    if (recorder && recorder.state !== "inactive") {
      const stopped = new Promise((resolve) =>
        recorder.addEventListener("stop", resolve, { once: true }),
      );
      recorder.stop();
      await stopped;
      const blob = new Blob(recorded, { type: recorder.mimeType });
      if (blob.size) {
        await store.saveAudio(recordAudioId, blob, {
          createdAt: now(),
          name: "Microphone recording",
        });
        await store.update(jobId, (t) => ({ ...t, audioId: recordAudioId }), {
          undo: false,
        });
      }
      recorded = [];
      recorder = null;
    }
    updateStatus("Finishing pending segments…");
    await ctx.render();
  }
  async function upload() {
    if (busy()) return;
    readSettings();
    const file = $("#audioInput")?.files[0] || selectedFile;
    if (!file) throw new Error("Choose an audio file first.");
    const limit =
      (navigator.deviceMemory && navigator.deviceMemory <= 4 ? 40 : 100) *
      1024 *
      1024;
    if (file.size > limit)
      throw new Error(
        "Split the recording into files smaller than " +
          limit / 1024 / 1024 +
          " MB.",
      );
    starting = true;
    updateStatus("Preparing audio…");
    try {
      const seconds = await audioDuration(file);
      if (!Number.isFinite(seconds))
        throw new Error(
          "This file has no readable duration. Convert it to WAV or MP3.",
        );
      if (seconds > 3600)
        throw new Error(
          "Split recordings longer than one hour into smaller files.",
        );
      const streaming = seconds > 180;
      fileMode = streaming;
      if (streaming) {
        mic = new FileCapture(file, pushSamples, async () => {
          capturing = false;
          await mic.stop();
          flush();
          await ctx.render();
          updateStatus();
        });
        await mic.prepare();
      }
      const samples = streaming ? null : await decodeAudio(file);
      const t = await begin(file.name.replace(/\.[^.]+$/, ""));
      const audioId = id();
      await store.saveAudio(audioId, file, {
        name: file.name,
        createdAt: now(),
      });
      await store.update(t.id, (t) => ({ ...t, audioId }), { undo: false });
      selectedFile = null;
      captureMode = "upload";
      uploadTotal = Math.ceil(seconds / 8);
      if (streaming) {
        capturing = true;
        paused = false;
        await mic.start();
        await ctx.render();
        toast(
          "Long recordings process in chunks at playback speed. You can pause or stop at any time.",
        );
      } else {
        totalSamples = samples.length;
        for (let offset = 0; offset < samples.length; offset += 128000) {
          const part = samples.slice(offset, offset + 128000);
          queue.push({
            samples: part,
            start: offset / 16000,
            length: part.length / 16000,
            id: t.id,
            hint: settings.source,
          });
        }
        await ctx.render();
        processSpeech();
      }
      updateStatus();
    } catch (e) {
      captureError = e.message;
      await mic?.stop();
      throw e;
    } finally {
      starting = false;
      updateStatus();
    }
  }
  function bindEditors() {
    document.querySelectorAll("[data-segment-edit]").forEach((el) => {
      const draft = localStorage.getItem(
        "studyPlatform.segmentDraft." +
          el.dataset.transcript +
          "." +
          el.dataset.segmentEdit,
      );
      if (draft && el !== document.activeElement) {
        const patch = JSON.parse(draft);
        if (el.dataset.field in patch) el.value = patch[el.dataset.field];
        clearTimeout(el.saveTimer);
        el.saveTimer = setTimeout(
          () =>
            saveSegment(el.dataset.transcript, el.dataset.segmentEdit).catch(
              (e) => toast(e.message),
            ),
          300,
        );
      }
      el.oninput = () => {
        const key =
          "studyPlatform.segmentDraft." +
          el.dataset.transcript +
          "." +
          el.dataset.segmentEdit;
        const existing = JSON.parse(localStorage.getItem(key) || "{}");
        localStorage.setItem(
          key,
          JSON.stringify({ ...existing, [el.dataset.field]: el.value }),
        );
        clearTimeout(el.saveTimer);
        el.saveTimer = setTimeout(
          () =>
            saveSegment(el.dataset.transcript, el.dataset.segmentEdit).catch(
              (e) => toast(e.message),
            ),
          300,
        );
      };
    });
    document.querySelectorAll("[data-segment-language]").forEach(
      (el) =>
        (el.onchange = async () => {
          await store.update(
            el.dataset.transcript,
            (t) => ({
              ...t,
              segments: t.segments.map((s) =>
                s.id === el.dataset.segmentLanguage
                  ? {
                      ...s,
                      sourceLanguage: el.value,
                      languageMethod: "manual",
                      translationSignature: null,
                    }
                  : s,
              ),
            }),
            { undo: false },
          );
          enqueueTranslation(el.dataset.transcript, el.dataset.segmentLanguage);
          refreshSegments();
        }),
    );
  }
  const segmentSaves = new Map();
  async function saveSegment(tid, sid) {
    const key = "studyPlatform.segmentDraft." + tid + "." + sid;
    if (segmentSaves.has(key)) return segmentSaves.get(key);
    const job = (async () => {
      do {
        await commitSegment(tid, sid);
      } while (localStorage.getItem(key));
    })().finally(() => segmentSaves.delete(key));
    segmentSaves.set(key, job);
    return job;
  }
  async function commitSegment(tid, sid) {
    const key = "studyPlatform.segmentDraft." + tid + "." + sid,
      raw = localStorage.getItem(key);
    if (!raw) return;
    const patch = JSON.parse(raw);
    await store.update(
      tid,
      (t) => {
        const history = [
          ...(t.editHistory || []),
          { at: now(), text: textOf(t), translations: translatedOf(t) },
        ].slice(-50);
        const segments = t.segments.map((s) =>
          s.id === sid
            ? {
                ...s,
                originalText: s.originalText ?? s.text,
                originalTranslation: s.originalTranslation ?? s.translatedText,
                ...patch,
                ...("text" in patch ? { translationSignature: null } : {}),
                ...("translatedText" in patch
                  ? { translationStatus: "edited" }
                  : "text" in patch
                    ? { translationStatus: "needs_update" }
                    : {}),
              }
            : s,
        );
        return {
          ...t,
          segments,
          editedText: segments.map((s) => s.text ?? s.originalText).join("\n"),
          editHistory: history,
        };
      },
      { undo: false },
    );
    if (localStorage.getItem(key) === raw) localStorage.removeItem(key);
    const label = $("#transcriptSaveStatus");
    if (label) label.textContent = "Saved on this device.";
  }
  async function saveAll() {
    for (const key of Object.keys(localStorage).filter((k) =>
      k.startsWith("studyPlatform.segmentDraft."),
    )) {
      const [tid, sid] = key
        .slice("studyPlatform.segmentDraft.".length)
        .split(".");
      await saveSegment(tid, sid);
    }
    const legacy = $("#editedTranscript");
    if (legacy) {
      const value = legacy.value;
      await store.update(
        legacy.dataset.id,
        (t) => ({
          ...t,
          editedText: value,
          editHistory: [
            ...(t.editHistory || []),
            { at: now(), text: t.editedText ?? t.rawText },
          ].slice(-50),
        }),
        { undo: false },
      );
      localStorage.removeItem(
        "studyPlatform.transcriptDraft." + legacy.dataset.id,
      );
    }
  }
  function bind() {
    bindEditors();
    updateSetup();
    const form = $("#captureSettings");
    if (form)
      form.onchange = async () => {
        readSettings();
        $("#translationTarget").hidden = !settings.translate;
        setupError = "";
        updateSetup();
        try {
          await saveSettings();
          await refreshDisplay();
        } catch (e) {
          toast(e.message);
        }
      };
    const fileInput = $("#audioInput");
    if (fileInput) {
      if (selectedFile) {
        try {
          const transfer = new DataTransfer();
          transfer.items.add(selectedFile);
          fileInput.files = transfer.files;
        } catch {
          /* The filename below still identifies the retained file. */
        }
      }
      fileInput.onchange = () => chooseFile(fileInput.files[0]);
    }
    const dropZone = $("#audioDropZone");
    if (dropZone) {
      dropZone.ondragover = (e) => {
        e.preventDefault();
        if (!busy() && !installing) dropZone.classList.add("drag-over");
      };
      dropZone.ondragleave = () => dropZone.classList.remove("drag-over");
      dropZone.ondrop = (e) => {
        e.preventDefault();
        dropZone.classList.remove("drag-over");
        if (!busy() && !installing) chooseFile(e.dataTransfer.files[0]);
      };
    }
    const display = $("#transcriptDisplay");
    if (display)
      display.onchange = async () => {
        settings.display = display.value;
        try {
          await saveSettings();
          await refreshDisplay();
        } catch (e) {
          toast(e.message);
        }
      };
    const search = $("#transcriptSearch");
    if (search)
      search.onkeydown = (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          handle("find-transcript", search).catch((error) =>
            toast(error.message),
          );
        }
      };
    const legacy = $("#editedTranscript");
    if (legacy) {
      const saved = localStorage.getItem(
        "studyPlatform.transcriptDraft." + legacy.dataset.id,
      );
      if (saved) legacy.value = saved;
      legacy.oninput = () => {
        localStorage.setItem(
          "studyPlatform.transcriptDraft." + legacy.dataset.id,
          legacy.value,
        );
        clearTimeout(editTimer);
        editTimer = setTimeout(
          () => saveAll().catch((e) => toast(e.message)),
          300,
        );
      };
    }
    const seek = Number(location.hash.split("/")[2]);
    if (Number.isFinite(seek) && seek > 0) {
      const audio = $("#transcriptAudio");
      if (audio)
        audio.addEventListener(
          "loadedmetadata",
          () => (audio.currentTime = seek),
          { once: true },
        );
      const segment = store
        .get(selectedId)
        ?.segments?.find(
          (s) => seek >= s.start && seek <= (s.end ?? s.start + 8),
        );
      if (segment) {
        const row = $("#segment-" + CSS.escape(segment.id));
        row?.classList.add("focus-term");
      }
    }
  }
  function chooseFile(file) {
    selectedFile = file || null;
    const name = $("#audioFileName");
    if (name) name.textContent = file ? file.name : "or drop a file here";
    const clear = document.querySelector('[data-action="clear-audio-file"]');
    if (clear) clear.hidden = !file;
    const input = $("#audioInput");
    if (!file && input) input.value = "";
    captureError = "";
    $("#captureError")?.remove();
    updateStatus();
  }
  async function refreshDisplay() {
    const t = store.get(selectedId),
      container = $("#liveSegments");
    if (!t?.segments?.length || !container) return;
    await saveAll();
    container.innerHTML = store
      .get(selectedId)
      .segments.map((s) => segmentPair(s, t.id))
      .join("");
    const display = $("#transcriptDisplay")?.closest("label");
    if (display)
      display.hidden =
        !settings.translate &&
        !t.segments.some((s) => s.translatedText || s.targetLanguage);
    bindEditors();
  }
  function reviewDrafts(drafts, title, tid = null) {
    if (!drafts.length)
      throw new Error(
        "No suitable definitions or sentences were found. Add more notes, or create cards manually.",
      );
    modal(
      "Review local flashcard suggestions",
      `<p>These suggestions extract definitions or sentence prompts from your notes on this device. Review each card before saving.</p><div class="form-grid">${selectField("Destination set", "setId", [["new", "Create a new set"], ...store.list("set").map((s) => [s.id, s.title])], "new")}${field("New set title", "title", title + " · Study set")}${selectField("Folder for new set", "folderId", [["", "Unfiled"], ...store.list("folder").map((f) => [f.id, f.name])], "")}</div><div id="draftRows">${drafts.map((d, i) => `<article class="draft-card"><label class="check"><input type="checkbox" name="accept-${i}" checked aria-label="Accept suggestion ${i + 1}"></label><label>Term<textarea name="term-${i}">${esc(d.term)}</textarea></label><label>Definition<textarea name="definition-${i}">${esc(d.definition)}</textarea></label></article>`).join("")}</div>`,
      true,
      async (fd) => {
        await saveAll();
        let destination = store.get(fd.get("setId"));
        if (!destination)
          destination = createStudySet({
            title: String(fd.get("title") || title),
            folderId: fd.get("folderId") || null,
          });
        const values = drafts.flatMap((d, i) =>
          fd.has("accept-" + i)
            ? [
                {
                  ...d,
                  term: String(fd.get("term-" + i)).trim(),
                  definition: String(fd.get("definition-" + i)).trim(),
                },
              ]
            : [],
        );
        if (!values.length || values.some((c) => !c.term || !c.definition))
          throw new Error("Accept at least one complete card.");
        const cards = values.map((d, i) =>
          createFlashcard(
            destination.id,
            {
              term: d.term,
              definition: d.definition,
              provenance: tid ? { transcriptId: tid, ...d.provenance } : null,
            },
            store.list("card").filter((c) => c.setId === destination.id)
              .length + i,
          ),
        );
        await store.putMany([destination, ...cards]);
        ctx.go("set/" + destination.id);
        toast(cards.length + " cards saved.");
      },
      { submitLabel: "Save approved cards" },
    );
  }
  async function handle(action, el) {
    const known = [
      "download-model",
      "cancel-model",
      "remove-model",
      "check-model",
      "start-recording",
      "pause-recording",
      "stop-recording",
      "cancel-processing",
      "transcribe-file",
      "pause-translation",
      "stop-translation",
      "translate-saved",
      "copy-transcript",
      "copy-translation",
      "rename-transcript",
      "delete-transcript",
      "export-transcript",
      "seek-audio",
      "save-transcript",
      "delete-audio",
      "draft-cards",
      "cards-from-notes",
      "find-transcript",
      "capture-mode",
      "clear-audio-file",
      "new-transcript",
      "download-required",
      "cancel-setup",
      "diagnose-model",
      "save-model-host",
      "reset-model-host",
      "offer-high",
      "dismiss-high",
    ];
    if (!known.includes(action)) return false;
    const tid = el.dataset.id || selectedId,
      t = store.get(tid);
    if (action === "capture-mode") {
      if (busy()) return true;
      captureMode = el.dataset.mode;
      $("#recordPanel").hidden = captureMode !== "record";
      $("#uploadPanel").hidden = captureMode !== "upload";
      document
        .querySelectorAll('[data-action="capture-mode"]')
        .forEach((control) =>
          control.setAttribute(
            "aria-pressed",
            String(control.dataset.mode === captureMode),
          ),
        );
      updateStatus();
    } else if (action === "clear-audio-file") chooseFile(null);
    else if (action === "new-transcript") {
      if (busy())
        throw new Error("Finish or cancel the current recording first.");
      await saveAll();
      selectedId = jobId = null;
      doneChunks = totalSamples = uploadTotal = 0;
      captureError = "";
      ctx.go("transcripts");
    } else if (action === "download-required") {
      readSettings();
      const keys = requiredKeys().filter(
        (key) => !manager.states.get(key)?.offline,
      );
      if (!keys.length || installing) return true;
      const models = keys.map((key) => MODELS.find((m) => m.key === key));
      modal(
        "Set up transcription",
        `<p>Download these files to this browser:</p><ul>${models.map((m) => `<li>${modelName(m)} · ${size(m)}</li>`).join("")}</ul>${keys.some((key) => manager.states.get(key)?.runtimeMissing?.length) ? "<p>Shared processing files add about 22 MB.</p>" : ""}<p>After setup, recording and translation work offline.</p>`,
        true,
        async () => {
          installing = true;
          setupCancelled = false;
          setupKeys = keys;
          setupError = "";
          updateSetup();
          (async () => {
            try {
              for (const key of keys) {
                if (setupCancelled) break;
                await manager.download(key);
              }
              if (!setupCancelled) toast("Ready to record or upload audio.");
            } catch (e) {
              setupError =
                e.name === "AbortError"
                  ? "Download cancelled. You can resume it."
                  : e.message;
            } finally {
              installing = false;
              updateSetup();
            }
          })();
        },
        { submitLabel: "Download files" },
      );
    } else if (action === "cancel-setup") {
      setupCancelled = true;
      for (const key of new Set([...setupKeys, ...requiredKeys()]))
        manager.cancel(key);
    } else if (action === "download-model") {
      const m = MODELS.find((m) => m.key === el.dataset.key);
      modal(
        "Download " + m.label,
        `<p>About ${size(m)}${manager.states.get(m.key)?.runtimeMissing?.length ? " + 22 MB processing files" : ""}. Saved in this browser for offline use.</p>${m.key === "high" ? '<p class="notice">Accurate speech needs more memory. Fast speech is better for live recording on phones.</p>' : ""}`,
        true,
        async () => {
          manager.download(m.key).catch((e) => toast(e.message));
          return true;
        },
        { submitLabel: "Download model" },
      );
    } else if (action === "offer-high") {
      // Choosing this button is the confirmation: the size is stated in the offer.
      navigator.storage?.persist?.().catch(() => {});
      manager.download("high").catch(() => {});
    } else if (action === "dismiss-high") {
      try {
        localStorage.setItem(OFFER_KEY, String(Date.now() + 14 * 86400000));
      } catch {}
      updateOffer();
    } else if (action === "save-model-host") {
      const host = saveModelHost($("#modelHost").value);
      toast(
        host
          ? "Models will be downloaded from " + new URL(host).host + "."
          : "Models will be downloaded from huggingface.co.",
      );
    } else if (action === "reset-model-host") {
      saveModelHost("");
      if ($("#modelHost")) $("#modelHost").value = "";
      toast("Models will be downloaded from huggingface.co.");
    } else if (action === "diagnose-model") {
      const key = el.dataset.key || "fast";
      const dialog = modal(
        "Checking the connection…",
        '<p class="muted" id="diagnosis">Trying each address the download needs. This takes a few seconds.</p>',
        false,
      );
      const checks = await manager.diagnose(key);
      if (!dialog.isConnected) return true;
      const bad = checks.filter((c) => !c.ok);
      dialog.querySelector("#modalTitle").textContent = bad.length
        ? "Some addresses could not be reached"
        : "Everything is reachable";
      dialog.querySelector("#diagnosis").outerHTML =
        `<ul class="diagnosis">${checks.map((c) => `<li class="${c.ok ? "ok" : "bad"}"><strong>${c.ok ? "✓" : "✗"} ${esc(c.label)}</strong><small>${esc(c.detail)}</small></li>`).join("")}</ul><p class="muted">${
          bad.length
            ? bad.some((c) => c.id === "downloads") &&
              !bad.some((c) => c.id === "catalogue")
              ? "huggingface.co works but its download servers do not. Allow <code>hf.co</code> and <code>*.hf.co</code> in your network, VPN or content blocker, or use a download address under Settings. Then choose Try again; finished files are kept."
              : "Fix the blocked address, then choose Try again; finished files are kept."
            : "The addresses respond. If a download still fails, choose Try again: it continues from the bytes already received."
        }</p>`;
    } else if (action === "cancel-model") manager.cancel(el.dataset.key);
    else if (action === "check-model") {
      const s = await manager.status(el.dataset.key);
      toast(
        s.offline
          ? "All required model and runtime files are cached."
          : s.error || "Some files are missing. Download to install or repair.",
      );
    } else if (action === "remove-model")
      confirmAction(
        "Remove downloaded model?",
        "Saved transcripts and recordings will remain.",
        async () => {
          if (busy())
            throw new Error(
              "Finish or cancel processing before removing a model.",
            );
          asr.cancel();
          translator.cancel();
          await manager.remove(el.dataset.key);
        },
        "Remove model",
      );
    else if (action === "start-recording") await startRecording();
    else if (action === "pause-recording") {
      if (paused) {
        autoPaused = false;
        await mic.resume();
        recorder?.resume();
        paused = false;
      } else {
        autoPaused = false;
        mic.pause();
        recorder?.pause();
        paused = true;
        flush();
      }
      updateStatus();
    } else if (action === "stop-recording") await stopRecording();
    else if (action === "cancel-processing") {
      cancelled = true;
      queue = [];
      transQueue = [];
      asr.cancel();
      translator.cancel();
      if (capturing) await stopRecording();
      pcm = new Float32Array(0);
      updateStatus("Processing cancelled. Finalized text is saved.");
    } else if (action === "transcribe-file") await upload();
    else if (action === "pause-translation") {
      translationPaused = !translationPaused;
      if (!translationPaused) processTranslation();
      el.textContent = translationPaused
        ? "Resume translation"
        : "Pause translation";
      updateStatus();
    } else if (action === "stop-translation") {
      translationPaused = true;
      transQueue = [];
      translator.cancel();
      updateStatus();
    } else if (action === "translate-saved") {
      readSettings();
      translationPaused = false;
      await saveAll();
      for (const s of t.segments || []) enqueueTranslation(t.id, s.id);
      if (!t.segments?.length) {
        const segments = finalizeSegments(
          { text: textOf(t) },
          0,
          0,
          settings.source,
        );
        await store.update(t.id, (t) => ({ ...t, segments }));
        for (const s of segments) enqueueTranslation(t.id, s.id);
      }
      await ctx.render();
    } else if (action === "copy-transcript" || action === "copy-translation") {
      await saveAll();
      const updated = store.get(tid);
      await navigator.clipboard.writeText(
        action === "copy-transcript" ? textOf(updated) : translatedOf(updated),
      );
      toast("Copied.");
    } else if (action === "rename-transcript")
      modal(
        "Rename transcript",
        field("Title", "title", t.title, "text", "required"),
        true,
        async (fd) => {
          await store.update(t.id, (t) => ({ ...t, title: fd.get("title") }));
          ctx.render();
        },
      );
    else if (action === "delete-transcript")
      confirmAction(
        "Delete transcript?",
        "The transcript moves to Recently Deleted. Local audio and linked cards are retained.",
        async () => {
          await store.remove(t.id);
          if (selectedId === t.id) selectedId = null;
          if (jobId === t.id) jobId = null;
          ctx.go("transcripts");
        },
        "Delete",
      );
    else if (action === "export-transcript") {
      await saveAll();
      download(t.title + ".json", JSON.stringify(store.get(t.id), null, 2));
      download(
        t.title + ".txt",
        textOf(store.get(t.id)) +
          "\n\nTRANSLATION\n" +
          translatedOf(store.get(t.id)),
        "text/plain;charset=utf-8",
      );
    } else if (action === "seek-audio") {
      const audio = $("#transcriptAudio");
      if (audio) audio.currentTime = Number(el.dataset.time);
    } else if (action === "save-transcript") {
      await saveAll();
      toast("Transcript saved.");
    } else if (action === "delete-audio")
      confirmAction(
        "Delete local recording?",
        "Transcript text and linked cards will remain. This removes only the audio on this device.",
        async () => {
          await store.deleteAudio(t.audioId);
          await store.update(t.id, (t) => ({ ...t, audioId: null }));
          ctx.render();
        },
        "Delete audio",
      );
    else if (action === "draft-cards") {
      await saveAll();
      const current = store.get(t.id);
      reviewDrafts(
        localCardDrafts(textOf(current), current.segments),
        t.title,
        t.id,
      );
    } else if (action === "cards-from-notes")
      modal(
        "Create cards from notes",
        field("Title", "title", "Class notes") +
          '<label>Notes<textarea name="notes" style="min-height:240px" required placeholder="Mitosis: cell division that produces two identical daughter cells.\nLa Sicilia è una regione nel sud dell’Italia."></textarea></label>',
        true,
        (fd) => {
          const text = String(fd.get("notes"));
          const drafts = localCardDrafts(text);
          setTimeout(() => {
            try {
              reviewDrafts(drafts, String(fd.get("title")));
            } catch (e) {
              toast(e.message);
            }
          }, 0);
        },
        { submitLabel: "Create suggestions" },
      );
    else if (action === "find-transcript") {
      const needle = $("#transcriptSearch").value.toLowerCase();
      const matches = [];
      if (needle)
        for (const input of document.querySelectorAll(
          "[data-segment-edit],#editedTranscript",
        )) {
          const text = input.value.toLowerCase();
          for (
            let at = text.indexOf(needle);
            at >= 0;
            at = text.indexOf(needle, at + needle.length)
          )
            matches.push({ input, at });
        }
      if (matches.length) {
        const index =
          searchPosition?.needle === needle
            ? (searchPosition.index + 1) % matches.length
            : 0;
        const { input, at } = matches[index];
        searchPosition = { needle, index };
        input.focus();
        input.setSelectionRange(at, at + needle.length);
        input.scrollIntoView({ block: "center" });
      } else toast("No matching text.");
    }
    return true;
  }
  window.addEventListener("beforeunload", () => {
    mic?.stop();
    asr.cancel();
    translator.cancel();
  });
  window.addEventListener("hashchange", () => {
    if (!location.hash.startsWith("#transcripts") && audioURL) {
      URL.revokeObjectURL(audioURL);
      audioURL = null;
    }
  });
  return {
    view,
    bind,
    handle,
    modelView,
    prepare,
    offer: offerHTML,
    updateOffer,
  };
}
