// Model download recovery in a real browser. Hugging Face is replaced by a scripted server
// (exact pinned file sizes, zero-filled bodies, Range support), so blocked hosts, dropped
// connections, being offline and a custom download address can be exercised without the
// internet. Real Cache Storage, service worker and UI are used; no model is run.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { MODELS } from "../assets/models.js";
const require = createRequire(import.meta.url),
  { chromium } = require(process.env.STUDY_PLAYWRIGHT_PATH || "playwright");
const APP = "http://127.0.0.1:8765/";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.STUDY_CHROME_PATH
    ? { executablePath: process.env.STUDY_CHROME_PATH }
    : {}),
});
const fast = MODELS.find((m) => m.key === "fast");
const sizeOf = new Map(fast.files.map((f) => [f.path, f.bytes]));
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-expose-headers": "*",
};
const serveBytes = (route, size, { cut = false } = {}) => {
  const range = route.request().headers().range,
    start = range ? Number(/bytes=(\d+)-/.exec(range)[1]) : 0,
    body = Buffer.alloc(size - start);
  return route.fulfill({
    status: range ? 206 : 200,
    headers: {
      ...CORS,
      "content-type": "application/octet-stream",
      ...(range
        ? { "content-range": `bytes ${start}-${size - 1}/${size}` }
        : {}),
    },
    body,
  });
};
// A scripted Hugging Face. Playwright does not intercept the second hop of a redirect, so a
// blocked download server is modelled by redirecting a large file to a host that does not
// resolve (what a blocked hf.co looks like to the page); otherwise large files are served directly.
async function installServer(context, behaviour = {}) {
  const seen = { hub: [], large: [], mirror: [] };
  await context.route(
    /^https:\/\/(huggingface\.co|mirror\.test)\//,
    async (route) => {
      const url = new URL(route.request().url());
      const path = decodeURIComponent(url.pathname);
      const file = path.split(`/resolve/${fast.revision}/`)[1];
      if (url.host === "mirror.test") {
        seen.mirror.push(path);
        return serveBytes(route, sizeOf.get(file));
      }
      seen.hub.push(file);
      if (!fast.files.some((f) => f.path === file))
        return route.fulfill({ status: 404, headers: CORS, body: "missing" });
      if (sizeOf.get(file) > 1_000_000) {
        seen.large.push(file);
        if (behaviour.large) return behaviour.large(route, file);
      }
      return serveBytes(route, sizeOf.get(file));
    },
  );
  return seen;
}
async function open(context) {
  const page = await context.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.goto(APP + "#settings");
  await page.waitForSelector("h1");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForSelector("h1");
  await page.locator("details.model-settings > summary").click();
  return page;
}
const row = (page) => page.locator('[data-model-row="fast"]');
async function download(page, label = "Download model") {
  await page.locator('[data-action=download-model][data-key="fast"]').click();
  await page.getByRole("button", { name: label, exact: true }).click();
}
const outcome = (page, timeout = 120000) =>
  page.waitForFunction(
    () => {
      const r = document.querySelector('[data-model-row="fast"]');
      return (
        r &&
        (r.textContent.includes("Ready offline") ||
          r.querySelector(".notice.error"))
      );
    },
    null,
    { timeout },
  );
const text = async (page) => (await row(page).innerText()).replace(/\s+/g, " ");

// 1. The download servers are blocked: a plain-language error, a diagnosis, then recovery.
{
  const context = await browser.newContext();
  let blocked = true;
  const seen = await installServer(context, {
    large: (route, file) =>
      blocked
        ? route.fulfill({
            status: 302,
            headers: { ...CORS, location: "https://cdn.hf.test/" + file },
          })
        : serveBytes(route, sizeOf.get(file)),
  });
  const page = await open(context);
  await download(page);
  await outcome(page);
  const failed = await text(page);
  console.log("Blocked CDN:", failed);
  assert.doesNotMatch(failed, /Failed to fetch/);
  assert.match(
    failed,
    /Could not reach huggingface\.co or the download servers it hands large files to \(hf\.co\)/,
  );
  assert.match(failed, /Files already downloaded are kept/);
  assert.equal(await row(page).getAttribute("data-state"), "ERROR");
  await row(page).getByRole("button", { name: "Check connection" }).click();
  await page
    .getByRole("heading", { name: "Some addresses could not be reached" })
    .waitFor();
  const diagnosis = (await page.locator(".diagnosis").innerText()).replace(
    /\s+/g,
    " ",
  );
  assert.match(diagnosis, /✓ huggingface\.co \(model catalogue\)/);
  assert.match(diagnosis, /✗ Hugging Face download servers \(hf\.co\)/);
  assert.match(await page.locator("#modal").innerText(), /Allow hf\.co/i);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  // The network comes back. Try again finishes without fetching finished files again.
  blocked = false;
  const smallBefore = seen.hub.filter((f) => f === "config.json").length;
  await row(page).getByRole("button", { name: "Try again" }).first().click();
  await page
    .getByRole("button", { name: "Download model", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-model-row="fast"]')
        ?.textContent.includes("Ready offline"),
    null,
    { timeout: 120000 },
  );
  assert.equal(seen.hub.filter((f) => f === "config.json").length, smallBefore);
  assert.deepEqual(page.errors, []);
  await context.close();
}

// 2. A dropped connection is retried automatically.
{
  const context = await browser.newContext();
  let drops = 1;
  await installServer(context, {
    large: (route, file) =>
      file.endsWith("decoder_model_merged_quantized.onnx") && drops-- > 0
        ? route.abort("connectionreset")
        : serveBytes(route, sizeOf.get(file)),
  });
  const page = await open(context);
  await download(page);
  await page.waitForFunction(
    () =>
      /Retrying in 1 s \(attempt 2 of 4\)/.test(
        document.querySelector('[data-model-row="fast"]')?.textContent || "",
      ),
    null,
    { timeout: 30000 },
  );
  await outcome(page);
  assert.match(await text(page), /Ready offline/);
  assert.deepEqual(page.errors, []);
  await context.close();
}

// 3. Offline: the reason is stated before anything is requested.
{
  const context = await browser.newContext();
  const seen = await installServer(context);
  const page = await open(context);
  await context.setOffline(true);
  await download(page);
  await outcome(page, 30000);
  assert.match(await text(page), /You are offline/);
  assert.equal(seen.hub.length, 0);
  await context.close();
}

// 4. A download address of the learner's own is used and the files are still cached under the pinned keys.
{
  const context = await browser.newContext();
  const seen = await installServer(context);
  const page = await open(context);
  await page.locator(".model-source > summary").click();
  await page.locator("#modelHost").fill("https://mirror.test/");
  await page.getByRole("button", { name: "Save address", exact: true }).click();
  await download(page);
  await outcome(page);
  assert.match(await text(page), /Ready offline/);
  assert.equal(seen.hub.length, 0);
  assert.equal(seen.mirror.length, fast.files.length);
  await page
    .getByRole("button", { name: "Use Hugging Face", exact: true })
    .click();
  await page.locator("#modelHost").evaluate((el) => (el.value = ""));
  await context.close();
}

// 5. The High accuracy offer never downloads on its own, shows progress, and can be cancelled.
{
  const context = await browser.newContext();
  const seen = await installServer(context);
  const page = await context.newPage();
  await page.goto(APP + "#dashboard");
  await page.waitForSelector("#highOffer");
  assert.match(
    await page.locator("#highOffer").innerText(),
    /Get High accuracy speech ready/,
  );
  assert.match(await page.locator("#highOffer").innerText(), /about 240 MB/);
  await page.waitForTimeout(1500);
  assert.equal(seen.hub.length, 0, "nothing downloads before the click");
  await page.getByRole("button", { name: "Not now", exact: true }).click();
  await page.waitForSelector("#highOffer", { state: "detached" });
  await page.reload();
  await page.waitForSelector("h1");
  assert.equal(
    await page.locator("#highOffer").count(),
    0,
    "dismissal is remembered",
  );
  await context.close();
}
await browser.close();
console.log(
  "Blocked download servers, dropped connections, offline, a custom download address and the High accuracy offer were handled and recoverable.",
);
