import { id } from "./core.js";
export class InferenceClient extends EventTarget {
  constructor() {
    super();
    this.worker = null;
    this.pending = new Map();
    this.busy = 0;
  }
  create() {
    this.worker = new Worker(
      new URL("./inference-worker.js", import.meta.url),
      { type: "module" },
    );
    this.worker.onmessage = ({ data }) => {
      if (data.event) {
        this.dispatchEvent(new CustomEvent(data.event, { detail: data }));
        return;
      }
      const p = this.pending.get(data.id);
      if (!p) return;
      this.pending.delete(data.id);
      this.busy--;
      clearTimeout(p.timeout);
      data.error ? p.reject(new Error(data.error)) : p.resolve(data.result);
    };
    this.worker.onerror = (e) => {
      this.cancel(
        new Error(
          "The local inference worker stopped: " +
            (e.message || "unknown error") +
            ". Retry or choose the Fast model.",
        ),
      );
      this.dispatchEvent(new CustomEvent("failure", { detail: e.message }));
    };
  }
  run(action, values = {}) {
    if (!this.worker) this.create();
    const requestId = id();
    this.busy++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () =>
          this.cancel(
            new Error(
              "Local processing took too long. Retry with the Fast model.",
            ),
          ),
        300000,
      );
      this.pending.set(requestId, { resolve, reject, timeout });
      const data = { id: requestId, action, ...values };
      this.worker.postMessage(
        data,
        values.samples ? [values.samples.buffer] : [],
      );
    });
  }
  cancel(error = new DOMException("Processing cancelled", "AbortError")) {
    this.worker?.terminate();
    this.worker = null;
    for (const p of this.pending.values()) {
      clearTimeout(p.timeout);
      p.reject(error);
    }
    this.pending.clear();
    this.busy = 0;
  }
}
const vocabulary = {
  it: new Set(
    "il lo la gli le un una uno della dello delle degli di del da nel nella oggi parleremo regione sud italia sicilia dove si trova grazie ciao sono è essere con per che questo questa italiano città capitale acqua".split(
      " ",
    ),
  ),
  en: new Set(
    "the a an of in on is are was we today will talk about does anyone remember where located thank you hello this that english city capital water".split(
      " ",
    ),
  ),
};
export function languageOf(text, fallback = null) {
  const words = text.toLowerCase().match(/[\p{L}]+/gu) || [];
  const scores = Object.fromEntries(
    Object.entries(vocabulary).map(([lang, set]) => [
      lang,
      words.filter((w) => set.has(w)).length,
    ]),
  );
  if (scores.it >= 2 && scores.it > scores.en + 1) return "it";
  if (scores.en >= 2 && scores.en > scores.it + 1) return "en";
  return fallback || "unknown";
}
export function finalizeSegments(result, start, length, hint = "auto") {
  const chunks = result.chunks?.length
    ? result.chunks
    : [{ text: result.text, timestamp: [0, length] }];
  const segments = [];
  for (const c of chunks) {
    const text = c.text?.trim();
    if (!text) continue;
    const parts = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
    const from = Math.max(0, Math.min(length, Number(c.timestamp?.[0]) || 0)),
      to = Math.max(from, Math.min(length, Number(c.timestamp?.[1]) || length));
    for (let i = 0; i < parts.length; i++) {
      const originalText = parts[i].trim();
      if (!originalText) continue;
      segments.push({
        id: id(),
        start: start + from + ((to - from) * i) / parts.length,
        end: start + from + ((to - from) * (i + 1)) / parts.length,
        originalText,
        text: originalText,
        sourceLanguage: ["it", "en"].includes(hint)
          ? hint
          : languageOf(originalText, result.language),
        languageMethod: ["it", "en"].includes(hint)
          ? "selected"
          : "model + text heuristic",
        translatedText: "",
        targetLanguage: null,
        translationStatus: "not_requested",
      });
    }
  }
  return segments;
}
export function localCardDrafts(text, segments = []) {
  const lines = text
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean),
    drafts = [];
  for (const line of lines) {
    const match = line.match(
      /^(.{1,100}?)\s*(?::|\s[-–—]\s|\s(?:is|are|means|è|sono|significa)\s)\s*(.{3,})$/i,
    );
    if (match) {
      const source = segments.find((s) =>
        (s.text || s.originalText || "").includes(line),
      );
      drafts.push({
        id: id(),
        term: match[1].trim(),
        definition: match[2].trim(),
        selected: true,
        provenance: source
          ? { segmentId: source.id, timestamp: source.start }
          : null,
      });
    }
  }
  if (!drafts.length) {
    for (const sentence of text.match(/[^.!?\n]+[.!?]?/g) || []) {
      const words = sentence.trim().split(/\s+/);
      if (words.length < 6) continue;
      const cut = Math.min(5, Math.floor(words.length / 2));
      drafts.push({
        id: id(),
        term: words.slice(0, cut).join(" ") + " …",
        definition: sentence.trim(),
        selected: true,
        provenance: segments.find((s) =>
          (s.text || s.originalText || "").includes(sentence.trim()),
        )
          ? {
              segmentId: segments.find((s) =>
                (s.text || s.originalText || "").includes(sentence.trim()),
              ).id,
              timestamp: segments.find((s) =>
                (s.text || s.originalText || "").includes(sentence.trim()),
              ).start,
            }
          : null,
      });
      if (drafts.length >= 50) break;
    }
  }
  return drafts.slice(0, 100);
}
