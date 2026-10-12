import { createRequire } from "node:module";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url),
  { chromium } = require(process.env.STUDY_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.STUDY_CHROME_PATH
    ? { executablePath: process.env.STUDY_CHROME_PATH }
    : {}),
});
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const APP = "http://127.0.0.1:8765/";
await page.goto(APP + "#library");
await page.waitForSelector("h1");
const id = await page.evaluate(async () => {
  const { Store } = await import("./assets/persistence.js"),
    { record } = await import("./assets/core.js");
  const s = await new Store().open();
  const seg = {
    id: "s1",
    start: 0,
    end: 5,
    text: "Ciao a tutti.",
    originalText: "Ciao a tutti.",
    sourceLanguage: "it",
    targetLanguage: "en",
    translatedText: "Hello everyone.",
    translationStatus: "done",
  };
  const mk = (title, createdAt, segments = []) =>
    record("transcript", {
      title,
      createdAt,
      rawText: "x",
      editedText: "x",
      segments,
      provider: "browser-local",
    });
  const rows = [
    mk("Old lecture", "2026-01-01T10:00:00.000Z"),
    mk("Middle lecture", "2026-03-01T10:00:00.000Z"),
    mk("New lecture", "2026-06-01T10:00:00.000Z", [seg]),
  ];
  await s.putMany(rows);
  s.channel?.close();
  s.db.close();
  return rows[2].id;
});
const titles = () =>
  page.locator(".transcript-list-row strong").allTextContents();
await page.goto(APP + "#transcripts");
await page.waitForSelector(".transcript-list-row");
assert.deepEqual(await titles(), [
  "New lecture",
  "Middle lecture",
  "Old lecture",
]);
const sort = page.getByRole("button", { name: /Change order/ });
assert.match(await sort.textContent(), /Newest first/);
await sort.click();
await page.waitForFunction(() =>
  /Oldest first/.test(
    document.querySelector('[data-action="sort-transcripts"]')?.textContent,
  ),
);
assert.deepEqual(await titles(), [
  "Old lecture",
  "Middle lecture",
  "New lecture",
]);
await page.reload();
await page.waitForSelector(".transcript-list-row");
assert.deepEqual(
  await titles(),
  ["Old lecture", "Middle lecture", "New lecture"],
  "the choice is remembered",
);
// An arrow joins the original card and its translation.
await page.goto(APP + "#transcripts/" + id);
await page.waitForSelector(".segment-pair");
assert.equal(await page.locator(".segment-pair .pair-arrow svg").count(), 1);
const [a, arrow, b] = await page
  .locator(".segment-pair > *")
  .evaluateAll((els) => els.map((e) => e.getBoundingClientRect()));
assert(
  a.right <= arrow.left + 1 && arrow.right <= b.left + 1,
  "the arrow sits between the two cards",
);
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(200);
const [a2, arrow2, b2] = await page
  .locator(".segment-pair > *")
  .evaluateAll((els) => els.map((e) => e.getBoundingClientRect()));
assert(
  a2.bottom <= arrow2.top + 1 && arrow2.bottom <= b2.top + 1,
  "stacked on a phone, the arrow points down between them",
);
assert.deepEqual(errors, []);
await browser.close();
console.log(
  "Transcripts sort newest/oldest (remembered) and an arrow joins each original/translation pair.",
);
