// Back buttons, a single sync status label, and resetting statistics.
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
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
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
  const folder = record("folder", { name: "F1", parentId: null }),
    set = createStudySet({ title: "Back set", folderId: folder.id }),
    card = createFlashcard(set.id, { term: "a", definition: "b" }, 0);
  const attempts = [0, 1, 2].map((ago) => {
    const at = new Date();
    at.setDate(at.getDate() - ago);
    return record("attempt", {
      sessionId: "x",
      cardId: card.id,
      setId: set.id,
      direction: "forward",
      questionType: "written",
      response: "x",
      effectiveCorrect: true,
      at: at.toISOString(),
    });
  });
  const mastery = record("learning", {
    id: card.id + ":forward",
    cardId: card.id,
    setId: set.id,
    direction: "forward",
    contentRevision: 1,
    status: "MASTERED",
    attempts: 3,
    correct: 3,
    incorrect: 0,
    consecutiveCorrect: 3,
    recognition: 1,
    recall: 2,
    streakRecognition: 1,
    streakRecall: 2,
    nextEligible: 0,
  });
  await s.putMany([folder, set, card, ...attempts, mastery]);
  s.channel?.close();
  s.db.close();
  return { folder: folder.id, set: set.id };
});
const back = page.locator("#backButton");
const check = async (hash, expected, target) => {
  await page.goto(APP + "#" + hash);
  await page.waitForFunction(
    (e) => document.querySelector("#backButton")?.textContent === e,
    expected,
  );
  if (target) {
    await back.click();
    await page.waitForURL("**/#" + target);
  }
};
await page.goto(APP + "#dashboard");
await page.waitForSelector("h1");
assert.equal(await back.isHidden(), true, "nothing is above the dashboard");
for (const hash of ["library", "statistics", "settings", "transcripts"]) {
  await page.goto(APP + "#" + hash);
  await page.waitForSelector("#view h1");
  assert.equal(
    await back.isHidden(),
    true,
    hash + " has no back-to-dashboard button",
  );
}
await check("folder/" + ids.folder, "← Study Library", "library");
await check("set/" + ids.set, "← F1", "folder/" + ids.folder);
await check("sync", "← Settings", "settings");
// A study session goes back to its set.
await page.goto(APP + "#set/" + ids.set);
await page.getByRole("button", { name: "Flashcards", exact: true }).click();
await page.getByRole("button", { name: "Start studying", exact: true }).click();
await page.waitForSelector(".study-card");
await page.waitForFunction(
  () => document.querySelector("#backButton")?.textContent === "← Back set",
);
await back.click();
await page.waitForURL("**/#set/*");
// One sync status label.
assert.equal(await page.locator("#saveStatus").count(), 0);
assert.equal(await page.locator("#sidebarSync").count(), 1);
// Reset statistics.
await page.goto(APP + "#statistics");
await page.waitForFunction(() =>
  /Learn accuracy/.test(document.body.innerText),
);
assert.match(await page.locator("#view").innerText(), /100%/);
await page.goto(APP + "#settings");
await page.getByRole("button", { name: "Reset statistics…" }).click();
assert.match(
  await page.locator("#modal").innerText(),
  /3<?.*recorded answers|3\s+recorded answers/s,
);
await page.getByRole("button", { name: "Continue", exact: true }).click();
await page.getByRole("heading", { name: /step 2 of 2/ }).waitFor();
await page.locator("#modal [name=word]").fill("reset");
await page
  .getByRole("button", { name: "Erase statistics", exact: true })
  .click();
await page.waitForSelector("#modalError:not([hidden])");
await page.locator("#modal [name=word]").fill("RESET");
await page
  .getByRole("button", { name: "Erase statistics", exact: true })
  .click();
await page.waitForFunction(() =>
  /Statistics reset/.test(document.querySelector("#toast")?.textContent),
);
const after = await page.evaluate(async () => {
  const { Store } = await import("./assets/persistence.js");
  const s = await new Store().open(),
    r = {
      attempts: s.list("attempt").length,
      sets: s.list("set").length,
      cards: s.list("card").length,
      mastered: s.list("learning").filter((x) => x.status === "MASTERED")
        .length,
    };
  s.channel?.close();
  s.db.close();
  return r;
});
assert.deepEqual(
  after,
  { attempts: 0, sets: 1, cards: 1, mastered: 1 },
  "history erased; library and mastery kept",
);
await page.goto(APP + "#dashboard");
await page.waitForSelector(".streak-days");
assert.equal(await page.locator(".streak-days").textContent(), "0");
assert.deepEqual(errors, []);
await browser.close();
console.log(
  "Back buttons, one sync label and Reset statistics (two confirmations) passed.",
);
