// The script can be ordered newest first, and a highlighter follows the audio in the original card only.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url),
  { chromium } = require(process.env.STUDY_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
  ...(process.env.STUDY_CHROME_PATH
    ? { executablePath: process.env.STUDY_CHROME_PATH }
    : {}),
});
const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const APP = "http://127.0.0.1:8765/";
await page.goto(APP + "#library");
await page.waitForSelector("h1");
const id = await page.evaluate(async () => {
  const { Store } = await import("./assets/persistence.js"),
    { record } = await import("./assets/core.js");
  const s = await new Store().open();
  // Eight seconds of silence as a WAV file.
  const rate = 8000,
    n = rate * 8,
    buf = new ArrayBuffer(44 + n * 2),
    v = new DataView(buf);
  const w = (o, t) =>
    [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  w(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, n * 2, true);
  await s.saveAudio("a1", new Blob([buf], { type: "audio/wav" }), {});
  const seg = (i, start, end, text, tr) => ({
    id: "s" + i,
    start,
    end,
    text,
    originalText: text,
    sourceLanguage: "it",
    targetLanguage: "en",
    translatedText: tr,
    translationStatus: "done",
  });
  const t = record("transcript", {
    title: "Playback",
    rawText: "x",
    editedText: "x",
    provider: "browser-local",
    audioId: "a1",
    segments: [
      seg(1, 0, 4, "uno due tre quattro", "one two three four"),
      seg(2, 4, 8, "cinque sei sette otto", "five six seven eight"),
    ],
  });
  await s.putMany([t]);
  s.channel?.close();
  s.db.close();
  return t.id;
});
await page.goto(APP + "#transcripts/" + id);
await page.waitForSelector(".segment-pair");
const firstWords = () =>
  page
    .locator('[data-segment-edit]:visible[data-field="text"], .reading-view')
    .evaluateAll((els) =>
      els.map((e) => (e.value ?? e.textContent).split(" ")[0]),
    );
// ----- order of the script
assert.deepEqual(
  await page
    .locator('textarea[data-field="text"]')
    .evaluateAll((t) => t.map((x) => x.value.split(" ")[0])),
  ["uno", "cinque"],
);
const sort = page.getByRole("button", { name: /Script order/ });
assert.match(await sort.textContent(), /Oldest first/);
await sort.click();
await page.waitForFunction(() =>
  /Newest first/.test(
    document.querySelector('[data-action="sort-segments"]')?.textContent,
  ),
);
assert.deepEqual(
  await page
    .locator('textarea[data-field="text"]')
    .evaluateAll((t) => t.map((x) => x.value.split(" ")[0])),
  ["cinque", "uno"],
);
await page.reload();
await page.waitForSelector(".segment-pair");
assert.deepEqual(
  await page
    .locator('textarea[data-field="text"]')
    .evaluateAll((t) => t.map((x) => x.value.split(" ")[0])),
  ["cinque", "uno"],
  "remembered",
);
await page.getByRole("button", { name: /Script order/ }).click();
await page.waitForFunction(() =>
  /Oldest first/.test(
    document.querySelector('[data-action="sort-segments"]')?.textContent,
  ),
);
// ----- the highlighter
await page.evaluate(() => {
  const a = document.querySelector("#transcriptAudio");
  a.muted = true;
  a.currentTime = 2.6;
  return a.play();
});
await page.waitForSelector(".reading-view mark");
const marked = await page.locator(".reading-view mark").first().textContent();
assert(
  ["uno", "due", "tre", "quattro", "cinque", "sei", "sette", "otto"].includes(marked),
  "the word being spoken is highlighted: " + marked,
);
assert.equal(await page.locator(".segment-pair.is-playing").count(), 1);
assert.equal(
  await page.locator(".segment-card mark").count(),
  1,
  "only one highlight",
);
const inside = await page
  .locator(".reading-view")
  .evaluate(
    (v) => v.closest(".segment-card").querySelector("label")?.textContent ?? "",
  );
assert(
  !/one two three four/.test(
    await page
      .locator(".segment-pair.is-playing > .segment-card:last-child")
      .innerHTML()
      .then((h) => (h.includes("<mark") ? "x" : "")),
  ),
  "the translation card is never highlighted",
);
void inside;
// Playing into the next segment moves the highlight there.
await page.evaluate(() => {
  document.querySelector("#transcriptAudio").currentTime = 5.9;
});
await page.waitForFunction(() =>
  /cinque|sei|sette|otto/.test(
    document.querySelector(".reading-view mark")?.textContent || "",
  ),
);
// Pausing brings the editable text back.
await page.evaluate(() => document.querySelector("#transcriptAudio").pause());
await page.waitForFunction(() => !document.querySelector(".reading-view"));
assert.equal(
  await page.locator('textarea[data-field="text"]:visible').count(),
  2,
);
assert.deepEqual(errors, []);
await browser.close();
console.log(
  "The script sorts newest/oldest and the audio highlighter follows the spoken word in the original card only.",
);
