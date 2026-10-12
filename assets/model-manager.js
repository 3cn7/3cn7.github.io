import { MODELS, MODEL_CACHE, modelURL } from "./models.js";
export const RUNTIME_CACHE = "studyroom-runtime-v2";
export const RUNTIME_FILES = [
  "vendor/transformers.web.js",
  "vendor/ort-wasm-simd-threaded.jsep.mjs",
  "vendor/ort-wasm-simd-threaded.jsep.wasm",
];
export const HOST_KEY = "studyPlatform.modelHost";
export const MAX_ATTEMPTS = 4;
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);
const PARTIAL = "?studyroom-partial=1";
/**
 * A download problem with a plain-language message. `code` is one of OFFLINE, NETWORK, HTTP,
 * INCOMPLETE, STORAGE, RUNTIME or CANCELLED. Browsers report every network-level failure
 * (DNS, firewall, blocker, reset connection, or an error page without CORS headers) as the
 * same unhelpful "Failed to fetch"; this keeps the cause and the next step instead.
 */
export class DownloadError extends Error {
  constructor(message, code, extra = {}) {
    super(message);
    this.name = code === "CANCELLED" ? "AbortError" : "DownloadError";
    this.code = code;
    Object.assign(this, extra);
  }
}
const hostOf = (url) => {
  try {
    return new URL(url, "https://huggingface.co").host;
  } catch {
    return "the download server";
  }
};
function httpMessage(status, url) {
  const host = hostOf(url);
  if (status === 404)
    return `${host} no longer has this model file at its pinned address (HTTP 404). Update the app, or report this model as unavailable.`;
  if (status === 401 || status === 403)
    return `${host} refused the download (HTTP ${status}). The model may have become private or gated.`;
  if (status === 429)
    return `${host} is limiting downloads from this network (HTTP 429). Wait a few minutes, then try again.`;
  if (status >= 500)
    return `${host} is having trouble right now (HTTP ${status}). Try again in a few minutes.`;
  return `${host} answered with HTTP ${status}.`;
}
// A page cannot tell which address in a redirect chain failed, so name both for Hugging Face.
const networkMessage = (url) => {
  const host = hostOf(url),
    hf = host === "huggingface.co";
  return `Could not reach ${hf ? "huggingface.co or the download servers it hands large files to (hf.co)" : host}. The connection dropped, or a network setting is blocking it (VPN, firewall, school or work filter, or a privacy/ad blocker). Files already downloaded are kept; choose Try again, or Check connection to see which address is blocked.`;
};
function validHost(value) {
  try {
    const u = new URL(value);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
    if (u.protocol !== "https:" && !(local && u.protocol === "http:"))
      return null;
    if (u.search || u.hash) return null;
    return u.href.replace(/\/+$/, "");
  } catch {
    return null;
  }
}
export const readModelHost = () => {
  try {
    return validHost(localStorage.getItem(HOST_KEY)) || "";
  } catch {
    return "";
  }
};
export function saveModelHost(value) {
  const text = String(value || "").trim();
  if (!text) {
    localStorage.removeItem(HOST_KEY);
    return "";
  }
  const host = validHost(text);
  if (!host)
    throw new Error(
      "Use an https:// address without a query or fragment (http:// works only for localhost).",
    );
  localStorage.setItem(HOST_KEY, host);
  return host;
}
const wait = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted)
      return reject(new DownloadError("Cancelled.", "CANCELLED"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DownloadError("Cancelled.", "CANCELLED"));
      },
      { once: true },
    );
  });
export class ModelManager extends EventTarget {
  constructor({
    fetch: fetcher = (...args) => globalThis.fetch(...args),
    sleep = wait,
    host = readModelHost,
    backoff = (attempt) => Math.min(8000, 1000 * 2 ** (attempt - 1)),
  } = {}) {
    super();
    this.states = new Map();
    this.jobs = new Map();
    this.controllers = new Map();
    this.lastEvent = new Map();
    this.fetch = fetcher;
    this.sleep = sleep;
    this.host = host;
    this.backoff = backoff;
  }
  /** Where a file is fetched from: the pinned Hugging Face revision, or the learner's own mirror. */
  sourceURL(model, path) {
    const base = this.host();
    return base
      ? `${base}/${model.id}/resolve/${model.revision}/${path}`
      : modelURL(model, path);
  }
  emit(key, state, extra = {}) {
    const data = { ...this.states.get(key), key, state, ...extra };
    this.states.set(key, data);
    if (
      state === "DOWNLOADING" &&
      Date.now() - (this.lastEvent.get(key) || 0) < 100 &&
      !("note" in extra)
    )
      return data;
    this.lastEvent.set(key, Date.now());
    this.dispatchEvent(new CustomEvent("status", { detail: data }));
    return data;
  }
  async status(key) {
    const model = MODELS.find((m) => m.key === key);
    const cache = await caches.open(MODEL_CACHE);
    let bytes = 0,
      missing = [];
    for (const f of model.files) {
      const r = await cache.match(modelURL(model, f.path));
      if (!r || Number(r.headers.get("x-studyroom-bytes")) !== f.bytes)
        missing.push(f.path);
      else bytes += f.bytes;
    }
    const runtime = await caches.open(RUNTIME_CACHE);
    const runtimeMissing = [];
    for (const f of RUNTIME_FILES)
      if (!(await runtime.match(new URL(f, document.baseURI))))
        runtimeMissing.push(f);
    const busy = this.jobs.has(key);
    const previous = this.states.get(key);
    return this.emit(
      key,
      busy
        ? previous?.state || "DOWNLOADING"
        : missing.length
          ? previous?.state === "ERROR" && previous.error
            ? "ERROR"
            : "NOT_INSTALLED"
          : runtimeMissing.length
            ? "ERROR"
            : "READY",
      {
        bytes,
        missing,
        runtimeMissing,
        progress: (bytes / model.bytes) * 100,
        offline: !missing.length && !runtimeMissing.length,
        error: busy
          ? previous?.error || ""
          : !missing.length && runtimeMissing.length
            ? "Runtime files need downloading. Choose Download to repair."
            : missing.length && previous?.state === "ERROR"
              ? previous.error || ""
              : "",
        note: busy ? previous?.note || "" : "",
      },
    );
  }
  async all() {
    return Promise.all(MODELS.map((m) => this.status(m.key)));
  }
  async runtime() {
    const cache = await caches.open(RUNTIME_CACHE);
    for (const f of RUNTIME_FILES) {
      const url = new URL(f, document.baseURI);
      if (await cache.match(url)) continue;
      let r;
      try {
        r = await this.fetch(url);
      } catch {
        throw new DownloadError(
          "The processing files that ship with this site could not be loaded. Check your connection or refresh the page once the site is reachable.",
          "RUNTIME",
        );
      }
      if (!r.ok)
        throw new DownloadError(
          "The local inference runtime could not load. Refresh after the site update.",
          "RUNTIME",
        );
      await cache.put(url, r);
    }
  }
  /**
   * Download one file into the model cache. Network failures retry with backoff, an
   * interrupted transfer continues from the bytes already received (HTTP Range), and
   * bytes received by a failed or cancelled attempt are kept in the cache so a later
   * attempt, even after a reload, continues instead of starting over.
   */
  async fetchFile(model, file, signal, progress) {
    const cache = await caches.open(MODEL_CACHE),
      url = modelURL(model, file.path),
      source = this.sourceURL(model, file.path),
      partialKey = url + PARTIAL;
    let parts = [],
      received = 0,
      type = "application/octet-stream";
    const kept = await cache.match(partialKey);
    if (kept) {
      const blob = await kept.blob();
      if (blob.size && blob.size < file.bytes) {
        parts = [blob];
        received = blob.size;
        type = kept.headers.get("Content-Type") || type;
        progress(received, true);
      }
    }
    const keep = async () => {
      if (received && received < file.bytes)
        await cache
          .put(
            partialKey,
            new Response(new Blob(parts), {
              headers: {
                "Content-Type": type,
                "x-studyroom-bytes": String(received),
              },
            }),
          )
          .catch(() => {});
    };
    let last;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (signal.aborted) {
        await keep();
        throw new DownloadError(
          "Download cancelled. Files and partial progress are kept.",
          "CANCELLED",
        );
      }
      try {
        const headers = received ? { Range: `bytes=${received}-` } : {};
        const r = await this.fetch(source, { signal, headers });
        if (r.status === 416 && received) {
          // The kept bytes do not fit this file any more: start the file over.
          parts = [];
          received = 0;
          await cache.delete(partialKey);
          progress(0, true);
          continue;
        }
        if (!r.ok)
          throw new DownloadError(
            httpMessage(r.status, r.url || source),
            "HTTP",
            {
              status: r.status,
              retryAfter: Number(r.headers.get("retry-after")) || 0,
              url: r.url || source,
            },
          );
        let resumed = false;
        if (received) {
          const range = /^bytes (\d+)-\d+\/(\d+|\*)$/.exec(
            r.headers.get("content-range") || "",
          );
          resumed =
            r.status === 206 && !!range && Number(range[1]) === received;
          // A server that ignores Range sends the whole file again.
          if (!resumed) {
            parts = [];
            received = 0;
            progress(0, true);
          }
        }
        type = r.headers.get("Content-Type") || type;
        if (r.body?.getReader) {
          const reader = r.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            parts.push(value);
            received += value.length;
            progress(received);
          }
        } else {
          const buffer = new Uint8Array(await r.arrayBuffer());
          parts.push(buffer);
          received += buffer.length;
          progress(received);
        }
        if (received !== file.bytes) {
          const incomplete = received < file.bytes;
          if (!incomplete) {
            parts = [];
            received = 0;
            progress(0, true);
          }
          throw new DownloadError(
            incomplete
              ? "The file arrived incomplete."
              : "The file is larger than expected; starting it over.",
            "INCOMPLETE",
          );
        }
        await cache.put(
          url,
          new Response(new Blob(parts), {
            headers: {
              "Content-Type": type,
              "x-studyroom-bytes": String(received),
            },
          }),
        );
        await cache.delete(partialKey);
        return received;
      } catch (error) {
        if (signal.aborted || error.name === "AbortError") {
          await keep();
          throw new DownloadError(
            "Download cancelled. Files and partial progress are kept.",
            "CANCELLED",
          );
        }
        last =
          error instanceof DownloadError
            ? error
            : error.name === "QuotaExceededError"
              ? new DownloadError(
                  "There is not enough browser storage. Remove unused models first.",
                  "STORAGE",
                )
              : new DownloadError(networkMessage(source), "NETWORK", {
                  detail: error.message,
                  url: source,
                });
        const retryable =
          last.code === "NETWORK" ||
          last.code === "INCOMPLETE" ||
          (last.code === "HTTP" && RETRYABLE.has(last.status));
        if (!retryable || attempt === MAX_ATTEMPTS) {
          await keep();
          throw last;
        }
        const delay = Math.min(
          30000,
          Math.max(this.backoff(attempt), (last.retryAfter || 0) * 1000),
        );
        this.emit(model.key, "DOWNLOADING", {
          file: file.path,
          note: `Connection problem. Retrying in ${Math.ceil(delay / 1000)} s (attempt ${attempt + 1} of ${MAX_ATTEMPTS})…`,
        });
        try {
          await this.sleep(delay, signal);
        } catch (cancelled) {
          await keep();
          throw cancelled;
        }
        this.emit(model.key, "DOWNLOADING", { file: file.path, note: "" });
      }
    }
    throw last;
  }
  async download(key) {
    if (this.jobs.has(key)) return this.jobs.get(key);
    const model = MODELS.find((m) => m.key === key);
    const controller = new AbortController();
    this.controllers.set(key, controller);
    const work = async () => {
      try {
        if (globalThis.navigator?.onLine === false)
          throw new DownloadError(
            "You are offline. Connect to the internet, then try again. Files already downloaded are kept.",
            "OFFLINE",
          );
        const estimate = await navigator.storage?.estimate?.();
        if (
          estimate?.quota &&
          estimate.quota - estimate.usage < model.bytes * 1.2
        )
          throw new DownloadError(
            "There is not enough browser storage. Remove unused models first.",
            "STORAGE",
          );
        this.emit(key, "DOWNLOADING", { error: "", note: "", progress: 0 });
        await this.runtime();
        const cache = await caches.open(MODEL_CACHE);
        let completed = 0;
        for (const f of model.files) {
          const url = modelURL(model, f.path);
          const cached = await cache.match(url);
          if (
            cached &&
            Number(cached.headers.get("x-studyroom-bytes")) === f.bytes
          ) {
            completed += f.bytes;
            continue;
          }
          const got = await this.fetchFile(
            model,
            f,
            controller.signal,
            (bytes, reset) =>
              this.emit(key, "DOWNLOADING", {
                file: f.path,
                progress: ((completed + bytes) / model.bytes) * 100,
                ...(reset ? { note: "" } : {}),
              }),
          );
          completed += got;
        }
      } catch (e) {
        const error =
          e instanceof DownloadError
            ? e
            : new DownloadError(e.message || String(e), "NETWORK");
        this.emit(key, "ERROR", {
          error: error.message,
          code: error.code,
          note: "",
        });
        throw error;
      } finally {
        this.jobs.delete(key);
        this.controllers.delete(key);
      }
      return this.status(key);
    };
    const job = navigator.locks
      ? navigator.locks.request("studyroom-model-" + key, work)
      : work();
    this.jobs.set(key, job);
    return job;
  }
  cancel(key) {
    this.controllers.get(key)?.abort();
  }
  async remove(key) {
    if (this.jobs.has(key))
      throw new Error("Cancel the download before removing a model.");
    const model = MODELS.find((m) => m.key === key),
      cache = await caches.open(MODEL_CACHE);
    for (const f of model.files) {
      await cache.delete(modelURL(model, f.path));
      await cache.delete(modelURL(model, f.path) + PARTIAL);
    }
    this.emit(key, "NOT_INSTALLED", { error: "", note: "" });
    return this.status(key);
  }
  /**
   * Find out which address a failing download cannot reach. A page cannot see why a request
   * failed, so each address is tried separately: this site, the Hugging Face catalogue (small
   * files) and the download servers that Hugging Face redirects large files to.
   */
  async diagnose(key = "fast") {
    const model = MODELS.find((m) => m.key === key) || MODELS[0],
      big = [...model.files].sort((a, b) => b.bytes - a.bytes)[0],
      small = [...model.files].sort((a, b) => a.bytes - b.bytes)[0];
    const checks = [];
    const run = async (id, label, test) => {
      try {
        checks.push({ id, label, ok: true, detail: await test() });
      } catch (e) {
        checks.push({
          id,
          label,
          ok: false,
          detail:
            e instanceof DownloadError
              ? e.message
              : "Blocked or unreachable (" +
                (e.message || "network error") +
                ").",
        });
      }
    };
    const probe = async (url, headers = {}) => {
      const r = await this.fetch(url, { headers, cache: "no-store" });
      await r.body?.cancel?.();
      if (!r.ok)
        throw new DownloadError(httpMessage(r.status, r.url || url), "HTTP");
      return "Reachable";
    };
    await run("online", "Browser reports a connection", async () => {
      if (globalThis.navigator?.onLine === false)
        throw new DownloadError(
          "The browser says this device is offline.",
          "OFFLINE",
        );
      return "Online";
    });
    await run("site", "Processing files from this site", () =>
      probe(new URL(RUNTIME_FILES[2], document.baseURI), {
        Range: "bytes=0-0",
      }),
    );
    const base = this.host();
    await run(
      "catalogue",
      base
        ? `Your mirror (${hostOf(base)})`
        : "huggingface.co (model catalogue)",
      () => probe(this.sourceURL(model, small.path)),
    );
    await run(
      "downloads",
      base
        ? `Your mirror, large file (${big.path.split("/").pop()})`
        : "Hugging Face download servers (hf.co)",
      () => probe(this.sourceURL(model, big.path), { Range: "bytes=0-0" }),
    );
    return checks;
  }
}
