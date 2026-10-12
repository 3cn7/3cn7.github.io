import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
// The manager only needs fetch, Cache Storage, document.baseURI and a few navigator members,
// so its retry, resume and recovery rules can be tested here against scripted network failures.
class MemoryCache {
  constructor() {
    this.map = new Map();
  }
  async match(request) {
    const entry = this.map.get(String(request.url ?? request));
    return entry
      ? new Response(entry.blob, { headers: entry.headers })
      : undefined;
  }
  async put(request, response) {
    this.map.set(String(request.url ?? request), {
      blob: await response.blob(),
      headers: new Headers(response.headers),
    });
  }
  async delete(request) {
    return this.map.delete(String(request.url ?? request));
  }
}
const stores = new Map();
globalThis.caches = {
  async open(name) {
    if (!stores.has(name)) stores.set(name, new MemoryCache());
    return stores.get(name);
  },
};
globalThis.document = { baseURI: "https://site.test/" };
const navigatorValue = {
  onLine: true,
  storage: { estimate: async () => ({ quota: 1e12, usage: 0 }) },
};
Object.defineProperty(globalThis, "navigator", {
  value: navigatorValue,
  configurable: true,
});
const settings = new Map();
globalThis.localStorage = {
  getItem: (k) => settings.get(k) ?? null,
  setItem: (k, v) => settings.set(k, String(v)),
  removeItem: (k) => settings.delete(k),
};
const { MODELS, modelURL } = await import("../assets/models.js");
const {
  ModelManager,
  DownloadError,
  MAX_ATTEMPTS,
  RUNTIME_CACHE,
  RUNTIME_FILES,
  HOST_KEY,
  saveModelHost,
  readModelHost,
} = await import("../assets/model-manager.js");
const { MODEL_CACHE } = await import("../assets/models.js");

const FILES = [
  { path: "config.json", bytes: 40 },
  { path: "onnx/decoder.onnx", bytes: 9000 },
  { path: "onnx/encoder.onnx", bytes: 4000 },
];
const model = {
  key: "unit",
  id: "test/unit-model",
  revision: "r1",
  label: "Unit test model",
  task: "automatic-speech-recognition",
  bytes: FILES.reduce((n, f) => n + f.bytes, 0),
  files: FILES,
};
MODELS.push(model);
const content = (path, size) =>
  Uint8Array.from({ length: size }, (_, i) => (i * 7 + path.length) % 251);
const expected = Object.fromEntries(
  FILES.map((f) => [f.path, content(f.path, f.bytes)]),
);
const pathOf = (url) =>
  FILES.find((f) => String(url).endsWith("/" + f.path))?.path;
beforeEach(() => {
  stores.clear();
  navigatorValue.onLine = true;
  settings.clear();
});

// Delivers the bytes, then fails like a reset connection. (controller.error() would discard
// queued chunks, so the failure is raised on the pull after the data was read.)
function cutStream(bytes, error) {
  let step = 0;
  const half = Math.floor(bytes.length / 2);
  return new ReadableStream({
    pull(controller) {
      if (step === 0) controller.enqueue(bytes.slice(0, half));
      else if (step === 1) controller.enqueue(bytes.slice(half));
      else controller.error(error);
      step++;
    },
  });
}
// A scripted network. `plan(call, n)` returns what that request should do; the default is a clean answer.
function network(plan = () => "ok") {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    const href = String(url);
    const call = {
      url: href,
      range: init.headers?.Range || null,
      path: pathOf(href),
      n: 0,
    };
    call.n = calls.filter((c) => c.path === call.path).length + 1;
    calls.push(call);
    if (init.signal?.aborted) throw new DOMException("aborted", "AbortError");
    if (href.startsWith("https://site.test/"))
      return new Response(new Uint8Array(8));
    const step = plan(call, calls);
    if (step === "network") throw new TypeError("Failed to fetch");
    if (step?.status) {
      const { status, headers } = step;
      return new Response("no", { status, headers });
    }
    const body = expected[call.path];
    const start = call.range ? Number(/bytes=(\d+)-/.exec(call.range)[1]) : 0;
    const honoursRange = step?.ignoreRange ? false : true;
    const from = honoursRange ? start : 0;
    const slice = body.slice(from);
    const headers = new Headers({ "Content-Type": "application/octet-stream" });
    let status = 200;
    if (call.range && honoursRange && start) {
      status = 206;
      headers.set(
        "Content-Range",
        `bytes ${start}-${body.length - 1}/${body.length}`,
      );
    }
    if (step?.cutAt != null) {
      const cut = Math.min(slice.length - 1, step.cutAt);
      return new Response(
        cutStream(slice.slice(0, cut), new TypeError("network error")),
        { status, headers },
      );
    }
    if (step?.extra)
      return new Response(new Uint8Array([...slice, 1, 2, 3]), {
        status,
        headers,
      });
    return new Response(slice, { status, headers });
  };
  fetcher.calls = calls;
  return fetcher;
}
const manager = (fetcher, extra = {}) => {
  const sleeps = [];
  const m = new ModelManager({
    fetch: fetcher,
    sleep: async (ms, signal) => {
      sleeps.push(ms);
      if (signal?.aborted) throw new DownloadError("Cancelled.", "CANCELLED");
    },
    ...extra,
  });
  m.sleeps = sleeps;
  return m;
};
const cached = async (path) => {
  const cache = await caches.open(MODEL_CACHE);
  const r = await cache.match(modelURL(model, path));
  return r ? new Uint8Array(await r.arrayBuffer()) : null;
};

test("a clean download caches every pinned file with its exact byte length", async () => {
  const fetcher = network(),
    m = manager(fetcher);
  const status = await m.download("unit");
  assert.equal(status.state, "READY");
  assert.equal(status.offline, true);
  for (const f of FILES)
    assert.deepEqual(await cached(f.path), expected[f.path]);
  // Every request went to the pinned Hugging Face revision.
  assert(
    fetcher.calls
      .filter((c) => c.path)
      .every((c) => c.url === modelURL(model, c.path)),
  );
});

test("a dropped connection is retried with backoff instead of failing with 'Failed to fetch'", async () => {
  const fetcher = network((call) =>
      call.path === "config.json" && call.n < 3 ? "network" : "ok",
    ),
    m = manager(fetcher);
  const notes = [];
  m.addEventListener(
    "status",
    (e) => e.detail.note && notes.push(e.detail.note),
  );
  const status = await m.download("unit");
  assert.equal(status.state, "READY");
  assert.deepEqual(m.sleeps, [1000, 2000]);
  assert.match(notes[0], /Retrying in 1 s \(attempt 2 of 4\)/);
});

test("an interrupted transfer continues from the bytes already received", async () => {
  const fetcher = network((call) =>
    call.path === "onnx/decoder.onnx" && call.n === 1 ? { cutAt: 3000 } : "ok",
  );
  const m = manager(fetcher);
  await m.download("unit");
  const decoder = fetcher.calls.filter((c) => c.path === "onnx/decoder.onnx");
  assert.equal(decoder.length, 2);
  assert.equal(decoder[0].range, null);
  assert.equal(decoder[1].range, "bytes=3000-");
  assert.deepEqual(
    await cached("onnx/decoder.onnx"),
    expected["onnx/decoder.onnx"],
  );
});

test("a server that ignores Range simply restarts the file correctly", async () => {
  const fetcher = network((call) => {
    if (call.path !== "onnx/decoder.onnx") return "ok";
    return call.n === 1 ? { cutAt: 2000 } : { ignoreRange: true };
  });
  const m = manager(fetcher);
  await m.download("unit");
  assert.deepEqual(
    await cached("onnx/decoder.onnx"),
    expected["onnx/decoder.onnx"],
  );
});

test("after all attempts fail the error explains the cause, finished files stay, and Try again finishes the rest", async () => {
  let blocked = true;
  const fetcher = network((call) =>
    blocked && call.path === "onnx/decoder.onnx" ? "network" : "ok",
  );
  const m = manager(fetcher);
  await assert.rejects(m.download("unit"), (error) => {
    assert(error instanceof DownloadError);
    assert.equal(error.code, "NETWORK");
    assert.doesNotMatch(error.message, /^Failed to fetch$/);
    assert.match(error.message, /huggingface\.co/);
    assert.match(error.message, /Files already downloaded are kept/);
    return true;
  });
  assert.equal(m.states.get("unit").state, "ERROR");
  assert.equal(
    fetcher.calls.filter((c) => c.path === "onnx/decoder.onnx").length,
    MAX_ATTEMPTS,
  );
  assert.deepEqual(await cached("config.json"), expected["config.json"]);
  assert.equal(await cached("onnx/decoder.onnx"), null);
  // The network comes back: only the missing files are fetched.
  blocked = false;
  const before = fetcher.calls.length;
  const status = await m.download("unit");
  assert.equal(status.state, "READY");
  assert.equal(status.error, "");
  const again = fetcher.calls.slice(before).filter((c) => c.path);
  assert(!again.some((c) => c.path === "config.json"));
});

test("bytes from a failed attempt survive a reload and are resumed by a new manager", async () => {
  const failing = network((call) =>
    call.path === "onnx/decoder.onnx" ? { cutAt: 4000 } : "ok",
  );
  await assert.rejects(manager(failing).download("unit"));
  const resumed = network();
  const status = await manager(resumed).download("unit");
  assert.equal(status.state, "READY");
  const decoder = resumed.calls.find((c) => c.path === "onnx/decoder.onnx");
  assert.match(decoder.range, /^bytes=\d+-$/);
  assert(Number(/\d+/.exec(decoder.range)[0]) > 0);
  assert.deepEqual(
    await cached("onnx/decoder.onnx"),
    expected["onnx/decoder.onnx"],
  );
  const cache = await caches.open(MODEL_CACHE);
  assert.equal(
    await cache.match(
      modelURL(model, "onnx/decoder.onnx") + "?studyroom-partial=1",
    ),
    undefined,
  );
});

test("a missing file is reported as unavailable and is not retried", async () => {
  const fetcher = network((call) =>
    call.path === "config.json" ? { status: 404 } : "ok",
  );
  const m = manager(fetcher);
  await assert.rejects(m.download("unit"), (error) => {
    assert.equal(error.code, "HTTP");
    assert.equal(error.status, 404);
    assert.match(error.message, /no longer has this model file/);
    return true;
  });
  assert.equal(fetcher.calls.filter((c) => c.path === "config.json").length, 1);
});

test("rate limiting and server errors are retried, honouring Retry-After", async () => {
  const fetcher = network((call) =>
    call.path === "config.json" && call.n === 1
      ? { status: 429, headers: { "Retry-After": "7" } }
      : call.path === "onnx/encoder.onnx" && call.n === 1
        ? { status: 503 }
        : "ok",
  );
  const m = manager(fetcher);
  const status = await m.download("unit");
  assert.equal(status.state, "READY");
  assert.deepEqual(m.sleeps, [7000, 1000]);
});

test("a file with surplus bytes is rejected and downloaded again", async () => {
  const fetcher = network((call) =>
    call.path === "config.json" && call.n === 1 ? { extra: true } : "ok",
  );
  const m = manager(fetcher);
  await m.download("unit");
  assert.deepEqual(await cached("config.json"), expected["config.json"]);
});

test("cancelling keeps what was received and a later attempt continues", async () => {
  const m = manager(network());
  const original = m.fetch;
  let aborted = false;
  m.fetch = async (url, init) => {
    const r = await original(url, init);
    if (pathOf(url) === "onnx/decoder.onnx" && !aborted) {
      aborted = true;
      const reader = r.body.getReader();
      const first = await reader.read();
      m.cancel("unit");
      return new Response(
        cutStream(
          first.value.slice(0, 1500),
          new DOMException("aborted", "AbortError"),
        ),
        { status: 200 },
      );
    }
    return r;
  };
  await assert.rejects(
    m.download("unit"),
    (e) => e.name === "AbortError" && e.code === "CANCELLED",
  );
  const cache = await caches.open(MODEL_CACHE);
  const partial = await cache.match(
    modelURL(model, "onnx/decoder.onnx") + "?studyroom-partial=1",
  );
  assert.equal(Number(partial.headers.get("x-studyroom-bytes")), 1500);
  const resume = network();
  assert.equal((await manager(resume).download("unit")).state, "READY");
  assert.equal(
    resume.calls.find((c) => c.path === "onnx/decoder.onnx").range,
    "bytes=1500-",
  );
  assert.deepEqual(
    await cached("onnx/decoder.onnx"),
    expected["onnx/decoder.onnx"],
  );
});

test("offline is reported before any request is made", async () => {
  navigatorValue.onLine = false;
  const fetcher = network(),
    m = manager(fetcher);
  await assert.rejects(
    m.download("unit"),
    (e) => e.code === "OFFLINE" && /offline/i.test(e.message),
  );
  assert.equal(fetcher.calls.length, 0);
});

test("a learner's own download address is used, but files are cached under the pinned key", async () => {
  saveModelHost("https://mirror.test/models/");
  assert.equal(readModelHost(), "https://mirror.test/models");
  const fetcher = network(),
    m = manager(fetcher, { host: readModelHost });
  await m.download("unit");
  assert(
    fetcher.calls
      .filter((c) => c.path)
      .every((c) =>
        c.url.startsWith(
          "https://mirror.test/models/test/unit-model/resolve/r1/",
        ),
      ),
  );
  assert.deepEqual(await cached("config.json"), expected["config.json"]);
  assert.throws(() => saveModelHost("http://example.com"), /https/);
  assert.throws(() => saveModelHost("https://example.com/?x=1"), /https/);
  saveModelHost("http://localhost:9000");
  assert.equal(readModelHost(), "http://localhost:9000");
  saveModelHost("");
  assert.equal(settings.has(HOST_KEY), false);
});

test("the connection check says which address cannot be reached", async () => {
  const fetcher = network((call) =>
    call.path === "onnx/decoder.onnx" ? "network" : "ok",
  );
  const checks = await manager(fetcher).diagnose("unit");
  const byId = Object.fromEntries(checks.map((c) => [c.id, c]));
  assert.equal(byId.online.ok, true);
  assert.equal(byId.catalogue.ok, true);
  assert.equal(byId.downloads.ok, false);
  assert.match(byId.downloads.detail, /Blocked or unreachable/);
  navigatorValue.onLine = false;
  assert.equal(
    (await manager(network()).diagnose("unit")).find((c) => c.id === "online")
      .ok,
    false,
  );
});

test("removing a model also removes kept partial bytes", async () => {
  const failing = network((call) =>
    call.path === "onnx/decoder.onnx" ? { cutAt: 1000 } : "ok",
  );
  const m = manager(failing);
  await assert.rejects(m.download("unit"));
  await m.remove("unit");
  const cache = await caches.open(MODEL_CACHE);
  for (const f of FILES) {
    assert.equal(await cache.match(modelURL(model, f.path)), undefined);
    assert.equal(
      await cache.match(modelURL(model, f.path) + "?studyroom-partial=1"),
      undefined,
    );
  }
  assert.equal(m.states.get("unit").state, "NOT_INSTALLED");
  void RUNTIME_CACHE;
  void RUNTIME_FILES;
});
