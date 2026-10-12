// Collapsible sidebar, Empty bin, one scrolling frame for a set's terms, and the version label.
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
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const APP = "http://127.0.0.1:8765/";
await page.goto(APP + "#library");
await page.waitForSelector("h1");
const ids = await page.evaluate(async () => {
  const { Store } = await import("./assets/persistence.js"),
    { record, createStudySet, createFlashcard } = await import(
      "./assets/core.js"
    );
  const s = await new Store().open();
  const keep = createStudySet({ title: "Big set" }),
    gone = createStudySet({ title: "Doomed set" });
  await s.saveAudio(
    "rec9",
    new Blob([new Uint8Array(100)], { type: "audio/wav" }),
    {},
  );
  const t = record("transcript", {
    title: "Doomed lecture",
    rawText: "x",
    editedText: "x",
    segments: [],
    provider: "browser-local",
    audioId: "rec9",
  });
  const cards = Array.from({ length: 30 }, (_, i) =>
    createFlashcard(
      keep.id,
      { term: "term " + i, definition: "definition " + i },
      i,
    ),
  );
  await s.putMany([
    keep,
    gone,
    createFlashcard(gone.id, { term: "x", definition: "y" }, 0),
    ...cards,
    t,
  ]);
  s.channel?.close();
  s.db.close();
  return { keep: keep.id, gone: gone.id, t: t.id };
});
const width = () =>
  page.locator(".sidebar").evaluate((el) => el.getBoundingClientRect().width);
// ----- sidebar
await page.reload();
await page.waitForSelector("#view h1");
assert((await width()) > 200);
await page.getByRole("button", { name: "Collapse the sidebar" }).click();
await page.waitForFunction(
  () => document.querySelector(".sidebar").getBoundingClientRect().width < 100,
);
assert.equal(await page.locator(".nav-label").first().isVisible(), false);
assert.equal(
  await page.locator('[data-nav="library"]').getAttribute("title"),
  "Study Library",
);
await page.reload();
await page.waitForSelector("#view h1");
await page.waitForFunction(
  () => document.querySelector(".sidebar").getBoundingClientRect().width < 100,
);
// Folds away by itself inside a set, can be opened, and the saved choice returns elsewhere.
await page.getByRole("button", { name: "Expand the sidebar" }).click();
await page.waitForFunction(
  () => document.querySelector(".sidebar").getBoundingClientRect().width > 200,
);
await page.goto(APP + "#set/" + ids.keep);
await page.waitForSelector(".card-row");
await page.waitForFunction(
  () => document.querySelector(".sidebar").getBoundingClientRect().width < 100,
);
await page.getByRole("button", { name: "Expand the sidebar" }).click();
await page.waitForFunction(
  () => document.querySelector(".sidebar").getBoundingClientRect().width > 200,
);
await page.getByRole("button", { name: "Flashcards", exact: true }).click();
await page.getByRole("button", { name: "Start studying", exact: true }).click();
await page.waitForSelector(".study-card");
await page.waitForFunction(
  () => document.querySelector(".sidebar").getBoundingClientRect().width < 100,
);
await page.getByRole("button", { name: "Save & exit", exact: true }).click();
await page.waitForURL("**/#library");
await page.waitForFunction(
  () => document.querySelector(".sidebar").getBoundingClientRect().width > 200,
);
// ----- one scrolling frame
await page.goto(APP + "#set/" + ids.keep);
await page.waitForSelector("#termsFrame .card-row");
const frame = await page.locator("#termsFrame").evaluate((el) => ({
  scrolls: el.scrollHeight > el.clientHeight,
  overflow: getComputedStyle(el).overflowY,
}));
assert.deepEqual(frame, { scrolls: true, overflow: "auto" });
assert.equal(
  await page
    .locator("#termsFrame .status-list")
    .first()
    .evaluate((el) => getComputedStyle(el).overflowY),
  "visible",
  "no scroll boxes inside the frame",
);
assert.equal(await page.locator("#termsFrame .term-overview").count(), 1);
assert.equal(await page.locator("#termsFrame #cardList").count(), 1);
await page.locator("#termsFrame").evaluate((el) => (el.scrollTop = 600));
assert((await page.locator("#termsFrame").evaluate((el) => el.scrollTop)) > 0);
// ----- empty bin
await page.goto(APP + "#set/" + ids.gone);
await page
  .locator(".context-menu summary", { hasText: "More set actions" })
  .click();
await page.getByRole("button", { name: "Delete set", exact: true }).click();
await page
  .getByRole("button", { name: "Delete set", exact: true })
  .last()
  .click();
await page.waitForURL("**/#library");
await page.goto(APP + "#transcripts/" + ids.t);
await page.getByText("More", { exact: true }).first().click();
await page.getByRole("button", { name: "Move to trash" }).click();
await page
  .getByRole("button", { name: "Move to trash", exact: true })
  .last()
  .click();
await page.waitForURL("**/#transcripts");
await page.goto(APP + "#library");
await page
  .getByRole("button", { name: "Recently deleted", exact: true })
  .click();
assert.match(await page.locator("#modal").innerText(), /Doomed set/);
await page.getByRole("button", { name: "Empty bin…" }).click();
assert.match(
  await page.locator("#modal").innerText(),
  /1 set, 0 folders, 1 card and 1 transcript, and deletes 1 recording/,
);
await page
  .getByRole("button", { name: "Empty bin", exact: true })
  .last()
  .click();
await page.waitForFunction(() =>
  /bin is empty/.test(document.querySelector("#toast")?.textContent),
);
const after = await page.evaluate(async () => {
  const { Store } = await import("./assets/persistence.js");
  const s = await new Store().open(),
    r = {
      bin: s.records.filter(
        (x) =>
          x.deleted &&
          !x.erased &&
          ["set", "folder", "card", "transcript"].includes(x.type),
      ).length,
      audio: !!(await s.audio("rec9")),
      sets: s.list("set").length,
      cards: s.list("card").length,
    };
  s.channel?.close();
  s.db.close();
  return r;
});
assert.deepEqual(
  after,
  { bin: 0, audio: false, sets: 1, cards: 30 },
  "only the bin was emptied",
);
await page
  .getByRole("button", { name: "Recently deleted", exact: true })
  .click();
assert.equal(await page.getByRole("button", { name: "Empty bin…" }).count(), 0);
await page.getByRole("button", { name: "Close dialog" }).click();
// ----- version
assert.match(
  (await page.locator("#appVersion").textContent()).trim(),
  /^Version v\d+\.\d+\.\d+ · build [0-9a-f]{8}$/,
);
assert.deepEqual(errors, []);
await browser.close();
console.log(
  "Sidebar collapses (auto in sets and practice), the bin can be emptied, terms scroll in one frame, version shown.",
);
