import { createRequire } from "node:module";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url),
  { chromium } = require(process.env.STUDY_PLAYWRIGHT_PATH || "playwright");
// The profile keeps the downloaded models between runs; STUDY_MODEL_PROFILE reuses an existing one.
const context = await chromium.launchPersistentContext(
  process.env.STUDY_MODEL_PROFILE || "test-results/model-profile",
  {
    headless: true,
    executablePath: process.env.STUDY_CHROME_PATH || undefined,
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--use-file-for-fake-audio-capture=" +
        resolve("tests/fixtures/italian.wav"),
    ],
    permissions: ["microphone"],
    viewport: { width: 1440, height: 1100 },
  },
);
const page = await context.newPage();
const errors = [],
  outbound = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => {
  if (new URL(r.url()).origin !== "http://127.0.0.1:8765")
    outbound.push({ url: r.url(), method: r.method(), body: r.postData() });
});
page.on("console", (m) => {
  if (m.type() === "error")
    console.log("Browser error:", m.text().slice(0, 300));
});
try {
  await page.goto("http://127.0.0.1:8765/#settings");
  await page.waitForSelector("h1");
  await page.evaluate(async () => {
    const r = await navigator.serviceWorker.ready;
    await r.update();
    const w = r.installing || r.waiting;
    if (w && w.state !== "activated")
      await new Promise((resolve) =>
        w.addEventListener("statechange", () => {
          if (w.state === "activated") resolve();
        }),
      );
  });
  await page.reload();
  await page.waitForSelector("h1");
  // Every model is installed through the real UI from the real Hugging Face files.
  for (const key of ["fast", "balanced", "high", "it-en", "en-it"]) {
    console.log("Installing actual model:", key);
    if (
      await page
        .locator(`[data-model-row="${key}"] .model-detail`)
        .textContent()
        .then((s) => s.includes("Ready offline"))
    ) {
      console.log("Already cached:", key);
      continue;
    }
    await page
      .locator("details.model-settings")
      .evaluate((el) => (el.open = true));
    await page
      .locator(`[data-action=download-model][data-key="${key}"]`)
      .click();
    await page
      .getByRole("button", { name: "Download model", exact: true })
      .click();
    await page.waitForFunction(
      (key) =>
        document
          .querySelector(`[data-model-row="${key}"] .model-detail`)
          ?.textContent.includes("Ready offline"),
      key,
      { timeout: 360000 },
    );
    console.log("Cached:", key);
  }
  await page.goto("http://127.0.0.1:8765/#transcripts");
  await page.waitForSelector("#captureSettings");
  await page
    .locator("#captureSettings details")
    .evaluate((el) => (el.open = true));
  // Live capture must keep up with speech: use Fast (an earlier run may have left another choice saved).
  await page.getByLabel("Speech quality", { exact: true }).selectOption("fast");
  await page
    .getByLabel("Processing device", { exact: true })
    .selectOption("wasm");
  await page.waitForTimeout(300);
  await page
    .getByLabel("Spoken language", { exact: true })
    .selectOption("auto");
  await page.waitForTimeout(300);
  // Translation settings persist between runs, so switch it on before choosing a direction.
  await page.getByLabel("Live translation", { exact: true }).check();
  await page.waitForTimeout(300);
  await page.getByLabel("Translate into", { exact: true }).selectOption("en");
  await page.waitForTimeout(300);
  await page.waitForSelector("#captureSettings");
  await page
    .getByRole("button", { name: "Start recording", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document
        .querySelector("#captureState")
        ?.textContent.includes("Recording") ||
      document.querySelector("#toast")?.textContent.includes("configuration"),
    null,
    { timeout: 120000 },
  );
  assert.match(await page.locator("#captureState").textContent(), /Recording/);
  console.log("Real capture started");
  await page.waitForTimeout(17500);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const paused = await page.locator("#captureElapsed").textContent();
  await page.waitForTimeout(1200);
  assert.equal(await page.locator("#captureElapsed").textContent(), paused);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page.waitForTimeout(5000);
  console.log(
    "Before stop:",
    await page.locator("#captureElapsed").textContent(),
    await page.locator("#captureBacklog").textContent(),
  );
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.waitForFunction(
    () => {
      const backlog = document.querySelector("#captureBacklog");
      return (
        backlog?.dataset.speech === "0" && backlog.dataset.translation === "0"
      );
    },
    null,
    { timeout: 240000 },
  );
  let data = await page.evaluate(async () => {
    const { Store } = await import("./assets/persistence.js");
    const s = await new Store().open();
    return s.list("transcript");
  });
  const live = data.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  console.log("Microphone result:", JSON.stringify(live.segments));
  assert(
    live.segments.some(
      (s) => /sicil|palermo/i.test(s.text) && s.sourceLanguage === "it",
    ),
  );
  assert(live.rawText.includes("Italia"));
  assert(
    live.segments.some(
      (s) => s.translatedText && /sicil|palermo/i.test(s.translatedText),
    ),
  );
  assert.equal(
    new Set(live.segments.map((s) => s.id)).size,
    live.segments.length,
  );
  assert(live.audioId);
  assert(live.segments.every((s, i, a) => !i || s.start >= a[i - 1].start));
  // The installed cache, runtime, and application are used with all network disabled.
  console.log(
    "Offline worker verification code:",
    await page.evaluate(async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith("studyroom-ui-")) {
          const r = await (
            await caches.open(key)
          ).match(new URL("assets/inference-worker.js", location.href));
          if (r && (await r.text()).includes("Checking WebGPU")) return true;
        }
      }
      return false;
    }),
  );
  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector("#captureSettings");
  await page
    .locator("#captureSettings details")
    .evaluate((el) => (el.open = true));
  await page
    .getByLabel("Processing device", { exact: true })
    .selectOption("auto");
  await page.waitForTimeout(300);
  await page
    .locator("#captureSettings details")
    .evaluate((el) => (el.open = true));
  await page.getByLabel("Spoken language", { exact: true }).selectOption("en");
  await page.waitForSelector("#captureSettings");
  await page.getByLabel("Translate into", { exact: true }).selectOption("it");
  await page.waitForSelector("#captureSettings");
  await page
    .locator("#captureSettings details")
    .evaluate((el) => (el.open = true));
  await page.getByRole("button", { name: "Upload audio", exact: true }).click();
  await page
    .locator("#audioInput")
    .setInputFiles(resolve("tests/fixtures/english.wav"));
  const englishSince = new Date().toISOString();
  await page
    .getByRole("button", { name: "Transcribe file", exact: true })
    .click();
  await page.waitForFunction(
    (since) => {
      const h = document
        .querySelector("#liveSegments")
        ?.closest("section")
        ?.querySelector("h2");
      return (
        h?.textContent === "english" &&
        document.querySelector("#liveSegments [data-segment-pair]") != null
      );
    },
    englishSince,
    { timeout: 120000 },
  );
  await page.waitForFunction(
    () => {
      const backlog = document.querySelector("#captureBacklog");
      return (
        backlog?.dataset.speech === "0" && backlog.dataset.translation === "0"
      );
    },
    null,
    { timeout: 240000 },
  );
  data = await page.evaluate(async () => {
    const { Store } = await import("./assets/persistence.js");
    const s = await new Store().open();
    return s.list("transcript");
  });
  const upload = data
    .filter((t) => t.title === "english" && t.createdAt >= englishSince)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  console.log("Offline upload result:", JSON.stringify(upload?.segments));
  console.log(
    "Actual device:",
    await page.locator("#captureState").textContent(),
  );
  assert(upload?.segments.some((s) => /sicil|palermo/i.test(s.text)));
  assert(
    upload.segments.some(
      (s) => s.translatedText && /sicil|palermo/i.test(s.translatedText),
    ),
  );
  await page
    .getByLabel("Spoken language", { exact: true })
    .selectOption("mixed");
  await page.waitForTimeout(300);
  await page.getByLabel("Live translation", { exact: true }).check();
  await page.waitForTimeout(300);
  await page.getByLabel("Translate into", { exact: true }).selectOption("en");
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Upload audio", exact: true }).click();
  await page
    .locator("#audioInput")
    .setInputFiles(resolve("tests/fixtures/mixed.wav"));
  const mixedSince = new Date().toISOString();
  await page
    .getByRole("button", { name: "Transcribe file", exact: true })
    .click();
  let mixed;
  const mixedDeadline = Date.now() + 180000;
  while (Date.now() < mixedDeadline) {
    mixed = await page.evaluate(async (since) => {
      const req = indexedDB.open("studyPlatform.v1", 1);
      const db = await new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const read = db.transaction("records").objectStore("records").getAll();
      const rows = await new Promise((resolve, reject) => {
        read.onsuccess = () => resolve(read.result);
        read.onerror = () => reject(read.error);
      });
      db.close();
      const t = rows.find(
        (t) =>
          t.type === "transcript" &&
          t.title === "mixed" &&
          t.createdAt >= since,
      );
      return t?.segments?.length >= 2 &&
        t.segments.every((s) =>
          ["done", "same_language"].includes(s.translationStatus),
        )
        ? t
        : false;
    }, mixedSince);
    if (mixed) break;
    await page.waitForTimeout(300);
  }
  assert(
    mixed,
    "New mixed-language recording did not finish local translation",
  );
  await page.waitForFunction(
    () => {
      const backlog = document.querySelector("#captureBacklog");
      return (
        backlog?.dataset.speech === "0" && backlog.dataset.translation === "0"
      );
    },
    null,
    { timeout: 240000 },
  );
  console.log("Bilingual result:", JSON.stringify(mixed.segments));
  assert(
    mixed.segments.some(
      (s) => s.sourceLanguage === "it" && /oggi|sicilia/i.test(s.text),
    ),
  );
  assert(
    mixed.segments.some(
      (s) => s.sourceLanguage === "en" && /today|sicily/i.test(s.text),
    ),
  );
  // Balanced and High accuracy also run, offline, on the same English speech.
  for (const quality of ["balanced", "high"]) {
    await page
      .locator("#captureSettings details")
      .evaluate((el) => (el.open = true));
    await page
      .getByLabel("Speech quality", { exact: true })
      .selectOption(quality);
    await page
      .getByLabel("Spoken language", { exact: true })
      .selectOption("en");
    await page.getByLabel("Live translation", { exact: true }).uncheck();
    await page
      .getByRole("button", { name: "Upload audio", exact: true })
      .click();
    await page
      .locator("#audioInput")
      .setInputFiles(resolve("tests/fixtures/english.wav"));
    const since = new Date().toISOString();
    await page
      .getByRole("button", { name: "Transcribe file", exact: true })
      .click();
    let found;
    const limit = Date.now() + 240000;
    while (Date.now() < limit && !found) {
      found = await page.evaluate(async (since) => {
        const req = indexedDB.open("studyPlatform.v1", 1);
        const db = await new Promise((ok, no) => {
          req.onsuccess = () => ok(req.result);
          req.onerror = () => no(req.error);
        });
        const read = db.transaction("records").objectStore("records").getAll();
        const rows = await new Promise((ok, no) => {
          read.onsuccess = () => ok(read.result);
          read.onerror = () => no(read.error);
        });
        db.close();
        const t = rows.find(
          (t) =>
            t.type === "transcript" &&
            t.title === "english" &&
            t.createdAt >= since,
        );
        return t?.segments?.length ? t : false;
      }, since);
      if (!found) await page.waitForTimeout(500);
    }
    assert(found, quality + " recognition did not finish");
    console.log(
      quality + " result:",
      found.segments.map((x) => x.text).join(" "),
    );
    assert(
      /sicil|palermo/i.test(found.segments.map((x) => x.text).join(" ")),
      quality + " did not recognise the speech",
    );
    await page.waitForFunction(
      () => document.querySelector("#captureBacklog")?.dataset.speech === "0",
      null,
      { timeout: 240000 },
    );
  }
  const streamed = await page.evaluate(async (audioId) => {
    const { FileCapture } = await import("./assets/audio.js");
    const { Store } = await import("./assets/persistence.js");
    const store = await new Store().open();
    const file = (await store.audio(audioId)).blob;
    store.channel?.close();
    store.db.close();
    let count = 0,
      energy = 0;
    const capture = new FileCapture(
      file,
      (data) => {
        count += data.length;
        for (const x of data) energy += x * x;
      },
      () => {},
    );
    await capture.prepare();
    await capture.start();
    await new Promise((r) => setTimeout(r, 3000));
    capture.pause();
    const paused = count;
    await new Promise((r) => setTimeout(r, 500));
    if (count !== paused) throw new Error("File decoder did not pause");
    await capture.resume();
    await new Promise((r) => setTimeout(r, 500));
    await capture.stop();
    return { count, rms: Math.sqrt(energy / count) };
  }, mixed.audioId);
  assert(streamed.count > 16000 && streamed.rms > 0.01);
  console.log("Streaming decoder:", streamed);
  assert(
    outbound.every((r) => r.method === "GET" && !r.body),
    "Inference sent a remote request body",
  );
  assert(
    outbound.every(
      (r) =>
        new URL(r.url).hostname === "huggingface.co" ||
        new URL(r.url).hostname.endsWith(".huggingface.co") ||
        new URL(r.url).hostname.endsWith(".hf.co"),
    ),
  );
  assert.deepEqual(errors, []);
  await page.screenshot({
    path: "test-results/local-translation.png",
    fullPage: true,
  });
  console.log(
    "Actual WASM Whisper and both OPUS directions passed, including getUserMedia + AudioWorklet and offline reload.",
  );
} finally {
  await context.close();
}
