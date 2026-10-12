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
const page = await browser.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const submitModal = () => page.locator("#modal button[type=submit]").click();
const snapshot = () =>
  page.evaluate(async () => {
    const { Store } = await import("./assets/persistence.js");
    const s = await new Store().open();
    const rows = s.records;
    s.channel?.close();
    s.db.close();
    return rows;
  });
await page.goto("http://127.0.0.1:8765/#library");
await page.getByRole("button", { name: "+ Folder", exact: true }).click();
await page.getByLabel("Folder name", { exact: true }).fill("AP Italian");
await submitModal();
await page.getByRole("link", { name: "AP Italian", exact: true }).click();
const rootHash = new URL(page.url()).hash,
  rootId = rootHash.split("/")[1];
await page.getByRole("button", { name: "+ Folder", exact: true }).click();
await page.getByLabel("Folder name", { exact: true }).fill("Unit One");
await submitModal();
await page.getByRole("link", { name: "Unit One", exact: true }).click();
const childHash = new URL(page.url()).hash,
  childId = childHash.split("/")[1];
async function makeSet(title, text) {
  await page.getByRole("button", { name: "+ Create", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill(title);
  await submitModal();
  await page.waitForURL("**/#set/*");
  await page.getByRole("button", { name: "Import cards", exact: true }).click();
  await page.locator("#importText").fill(text);
  await page
    .getByRole("button", { name: "Add imported cards", exact: true })
    .click();
  await page.waitForSelector(".card-row");
}
await makeSet("Vocabulary", "ciao\thello\narrivederci\tgoodbye");
const originals = (await snapshot())
  .filter((r) => r.type === "card")
  .map((r) => r.id);
await page.getByRole("button", { name: "Set details", exact: true }).click();
await page.getByLabel("Folder", { exact: true }).selectOption(rootId);
await submitModal();
assert.deepEqual(
  (await snapshot()).filter((r) => r.type === "card").map((r) => r.id),
  originals,
);
await page.goto("http://127.0.0.1:8765/" + childHash);
await makeSet("Government", "la sovranità\tsovereignty");
const before = await snapshot(),
  cardIds = before.filter((r) => r.type === "card").map((r) => r.id);
await page.goto("http://127.0.0.1:8765/" + rootHash);
// A folder shows what is directly inside it; "all" studies everything below it too.
assert.equal(await page.locator(".set-tile").count(), 1);
await page.getByRole("button", { name: "Flashcards all", exact: true }).click();
await page.getByLabel("Direction", { exact: true }).selectOption("reverse");
await page.locator("[name=shuffle]").uncheck();
await page.locator("[name=audio]").uncheck();
await page
  .locator("#modal details")
  .filter({ has: page.locator("[name=autoFlip]") })
  .evaluate((el) => (el.open = true));
await page.locator("[name=autoFlip]").fill("1");
await page.locator("[name=autoAdvance]").fill("1");
await page.getByRole("button", { name: "Start studying", exact: true }).click();
await page.waitForSelector(".study-card");
const flash = (await snapshot()).find((r) => r.type === "session"),
  frontCard = before.find((r) => r.id === flash.sequence[0]);
assert.equal(
  await page.locator(".card-content").textContent(),
  frontCard.definition,
);
await page.getByRole("button", { name: "Auto play", exact: true }).click();
await page.waitForSelector(".study-card.flipped");
await page.locator(".star").click();
await page.waitForFunction(() =>
  document
    .querySelector("[data-action=flash-auto]")
    .textContent.includes("Auto"),
);
const position = (await snapshot()).find((r) => r.type === "session").index;
await page.waitForTimeout(1200);
assert.equal(
  (await snapshot()).find((r) => r.type === "session").index,
  position,
);
await page.getByRole("button", { name: "Save & exit", exact: true }).click();
await page.waitForURL("**/#library");
const session = (await snapshot()).find((r) => r.type === "session");
assert.equal(new Set(session.cardIds).size, 3);
assert(session.cardIds.every((id) => cardIds.includes(id)));
assert(Object.values(session.directionByCard).every((d) => d === "reverse"));
await page.goto("http://127.0.0.1:8765/" + rootHash);
await page.getByRole("button", { name: "Edit folder", exact: true }).click();
await page.getByLabel("Parent folder", { exact: true }).selectOption(childId);
await submitModal();
await page.waitForSelector("#modalError:not([hidden])");
assert(
  (await page.locator("#modalError").textContent()).includes(
    "one of its subfolders",
  ),
);
await page.getByRole("button", { name: "Cancel", exact: true }).click();
await page.getByRole("button", { name: "Delete folder", exact: true }).click();
await page.getByLabel("Contents", { exact: true }).selectOption("delete");
await page
  .getByRole("button", { name: "Delete folder", exact: true })
  .last()
  .click();
await page.waitForURL("**/#library");
const deleted = await snapshot();
assert.equal(deleted.filter((r) => r.type === "card" && !r.deleted).length, 0);
await page
  .getByRole("button", { name: "Recently deleted", exact: true })
  .click();
await page.locator(`[data-action=restore-record][data-id="${rootId}"]`).click();
await page.getByRole("button", { name: "Close dialog", exact: true }).click();
const restored = await snapshot();
assert.deepEqual(
  restored.filter((r) => r.type === "card" && !r.deleted).map((r) => r.id),
  cardIds,
);
assert.equal(restored.find((r) => r.id === childId).parentId, rootId);
await page.goto("http://127.0.0.1:8765/" + rootHash);
await page.getByRole("button", { name: "Test all", exact: true }).click();
await page.locator("#modal .advanced-study").evaluate((el) => (el.open = true));
await page.locator("[name=mc]").uncheck();
await page.locator("[name=written]").check();
await page.locator("[name=timerMinutes]").fill("1");
await page.getByRole("button", { name: "Start test", exact: true }).click();
await page.waitForSelector("#testTimer");
await page
  .locator("#writtenAnswer")
  .pressSequentially("rapid saved answer", { delay: 0 });
const inputDeadline = Date.now() + 10000;
let inputSaved = false;
while (Date.now() < inputDeadline) {
  const t = (await snapshot()).find((r) => r.type === "test");
  if (t?.answers[t.questions[0].id] === "rapid saved answer") {
    inputSaved = true;
    break;
  }
  await page.waitForTimeout(100);
}
assert(inputSaved, "Rapid input was not persisted");
await page.reload();
await page.waitForSelector("#writtenAnswer");
assert.equal(
  await page.locator("#writtenAnswer").inputValue(),
  "rapid saved answer",
);
// The countdown stopped while the page was closed; it never submits behind the learner's back.
await page.waitForTimeout(1500);
const paused = (await snapshot()).find((r) => r.type === "test");
assert(!paused.submittedAt);
assert(paused.remainingMs > 0 && paused.remainingMs <= 60000);
await page.evaluate(async () => {
  const { Store } = await import("./assets/persistence.js"),
    s = await new Store().open(),
    t = s.list("test")[0];
  await s.update(t.id, (r) => ({
    ...r,
    remainingMs: 0,
    deadline: Date.now() - 1000,
  }));
});
await page.reload();
await page.getByRole("heading", { name: "The time limit ended" }).waitFor();
assert(!(await snapshot()).find((r) => r.type === "test").submittedAt);
await page.getByRole("button", { name: "Submit answers", exact: true }).click();
await page.waitForSelector(".score");
const timed = (await snapshot()).find((r) => r.type === "test");
assert(timed.submittedAt);
assert.equal(timed.results.filter((r) => r.effectiveCorrect).length, 0);
assert.equal(timed.questions.length, 3);
assert.deepEqual(errors, []);
await browser.close();
console.log(
  "Nested folder UI, stable IDs on movement, combined reversed study, autoplay pause, circular guard, grouped deletion/recovery, and a paused timed test that is only submitted on request passed.",
);
