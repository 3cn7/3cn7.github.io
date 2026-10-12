import test from "node:test";
import assert from "node:assert/strict";
import { timerValue, transitionTimer } from "../assets/timer.js";
import {
  languageOf,
  finalizeSegments,
  localCardDrafts,
} from "../assets/transcription.js";
import { resample, wavBlob } from "../assets/audio.js";
import { MODELS } from "../assets/models.js";
test("Countdown and stopwatch use timestamps across suspension and pauses", () => {
  let countdown = {
    mode: "countdown",
    durationMs: 10000,
    valueMs: 10000,
    running: false,
  };
  countdown = transitionTimer(countdown, "start", 1000);
  assert.equal(timerValue(countdown, 9000), 2000);
  assert.equal(timerValue(countdown, 99000), 0);
  countdown = transitionTimer(countdown, "pause", 4000);
  assert.equal(timerValue(countdown, 99999), 7000);
  countdown = transitionTimer(countdown, "start", 50000);
  assert.equal(timerValue(countdown, 51000), 6000);
  let stopwatch = transitionTimer(
    { mode: "stopwatch", valueMs: 0, running: false },
    "start",
    1000,
  );
  stopwatch = transitionTimer(stopwatch, "pause", 5000);
  assert.equal(timerValue(stopwatch, 99000), 4000);
  stopwatch = transitionTimer(stopwatch, "start", 100000);
  assert.equal(timerValue(stopwatch, 103000), 7000);
});
test("Mixed-language sentences preserve source text, stable order, and separate translation fields", () => {
  const text =
    "Oggi parleremo della Sicilia. Does anyone remember where Sicily is located?";
  const rows = finalizeSegments({ text, language: "it" }, 24, 8, "mixed");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].sourceLanguage, "it");
  assert.equal(rows[1].sourceLanguage, "en");
  assert.notEqual(rows[0].id, rows[1].id);
  assert.equal(rows[0].start, 24);
  assert.equal(rows[1].end, 32);
  assert.equal(rows.map((s) => s.originalText).join(" "), text);
  assert(rows.every((s) => !s.translatedText));
  assert.equal(languageOf("xyz"), "unknown");
});
test("Pinned multilingual speech and translation variants have complete byte manifests", () => {
  assert.equal(MODELS.length, 5);
  assert(MODELS.every((m) => /^[a-f0-9]{40}$/.test(m.revision)));
  assert(
    MODELS.every(
      (m) => m.bytes === m.files.reduce((sum, f) => sum + f.bytes, 0),
    ),
  );
  assert(
    MODELS.filter((m) => m.task === "automatic-speech-recognition").every(
      (m) => !m.id.endsWith(".en"),
    ),
  );
});
test("Resampling preserves frequency duration and local WAV encoding", async () => {
  const pcm = Float32Array.from({ length: 48000 }, (_, i) =>
    Math.sin((i / 48000) * 440 * 2 * Math.PI),
  );
  const mono = resample(pcm, 48000);
  assert.equal(mono.length, 16000);
  const blob = wavBlob(mono);
  assert.equal(blob.size, 32044);
  assert.equal(
    new TextDecoder().decode((await blob.arrayBuffer()).slice(0, 4)),
    "RIFF",
  );
});
test("Local card extraction keeps factual definitions and transcript provenance", () => {
  const drafts = localCardDrafts(
    "Mitosis: cell division into two daughter cells.\nLa Sicilia è una regione nel sud dell’Italia.",
    [
      {
        id: "seg",
        start: 8,
        text: "La Sicilia è una regione nel sud dell’Italia.",
      },
    ],
  );
  assert.equal(drafts.length, 2);
  assert.equal(drafts[0].term, "Mitosis");
  assert.equal(drafts[1].term, "La Sicilia");
  assert.equal(drafts[1].provenance.segmentId, "seg");
  assert.equal(drafts[1].provenance.timestamp, 8);
});
