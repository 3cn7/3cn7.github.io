// Study starred terms from a set, and select terms (one by one or a whole progress section) to study or star.
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
const setId = await page.evaluate(async () => {
  const { Store } = await import("./assets/persistence.js"),
    { createStudySet, createFlashcard } = await import("./assets/core.js");
  const s = await new Store().open();
  const set = createStudySet({
    title: "Pick",
    termLanguage: "it",
    definitionLanguage: "en",
  });
  const words = [
    ["uno", "one"],
    ["due", "two"],
    ["tre", "three"],
    ["quattro", "four"],
    ["cinque", "five"],
  ];
  const cards = words.map(([term, definition], i) =>
    createFlashcard(set.id, { term, definition }, i),
  );
  cards[0].starred = true;
  cards[2].starred = true;
  await s.putMany([set, ...cards]);
  s.channel?.close();
  s.db.close();
  return set.id;
});
await page.goto(APP + "#set/" + setId);
await page.waitForSelector("#termsFrame");
// ----- study starred terms
await page.locator(".study-starred > summary").click();
assert.match(
  await page.locator(".study-starred > summary").innerText(),
  /Study starred \(2\)/,
);
await page
  .locator(".study-starred")
  .getByRole("button", { name: "Learn", exact: true })
  .click();
await page.waitForSelector("#modal");
assert.equal(
  await page.locator("#modal [name=filter]").inputValue(),
  "starred",
);
assert.match(
  await page.locator("#modal").innerText(),
  /2 complete terms|Starred only/,
);
await page.getByRole("button", { name: "Cancel", exact: true }).click();
// ----- select terms

await page.getByRole("button", { name: "Select terms" }).click();
assert.equal(await page.locator("#pickBar").count(), 1);
assert.match(await page.locator("#pickCount").innerText(), /^0 selected/);
assert.equal(
  await page.locator("#pickBar button[data-mode=learn]").isDisabled(),
  true,
);
// a whole progress section
await page.locator('input[data-pick-group="not-studied"]').check();
assert.match(await page.locator("#pickCount").innerText(), /^5 selected/);
assert.equal(await page.locator("input[data-pick]:checked").count(), 5);
await page.locator('input[data-pick-group="not-studied"]').uncheck();
assert.equal(await page.locator("input[data-pick]:checked").count(), 0);
// single terms, by box and by clicking the row
await page.locator("input[data-pick]").nth(1).check();
await page
  .locator(".card-row", { hasText: "quattro" })
  .locator(".mastered-term")
  .click();
assert.match(await page.locator("#pickCount").innerText(), /^2 selected/);
assert.equal(
  await page
    .locator('input[data-pick-group="not-studied"]')
    .evaluate((b) => b.indeterminate),
  true,
);
// study the selection
await page.locator("#pickBar button[data-mode=flashcards]").click();
await page.waitForSelector("#modal");
await page.getByRole("button", { name: "Start studying", exact: true }).click();
await page.waitForSelector(".study-layout, .flashcard, .panel");
const session = await page.evaluate(async () => {
  const { Store } = await import("./assets/persistence.js");
  const s = await new Store().open();
  const r = s.records.filter((x) => x.type === "session" && !x.deleted).at(-1);
  s.channel?.close();
  s.db.close();
  return r.cardIds.length;
});
assert.equal(session, 2, "only the selected terms are studied");
await page.goto(APP + "#set/" + setId);
await page.waitForSelector("#termsFrame");
assert.equal(
  await page.locator("#pickBar").count(),
  0,
  "selection mode is reset when you come back",
);
// star the selection
await page.getByRole("button", { name: "Select terms" }).click();
await page.locator('input[data-pick-group="not-studied"]').check();
await page.locator("#pickBar button[data-starred='1']").click();
await page.waitForFunction(() =>
  /5 terms starred/.test(document.querySelector("#toast")?.textContent),
);
assert.match(
  await page.locator(".study-starred > summary").innerText(),
  /\(5\)/,
);
await page.getByRole("button", { name: "Clear" }).click();
await page.locator('input[data-pick-group="not-studied"]').check();
await page.locator("#pickBar button[data-starred='0']").click();
await page.waitForFunction(() =>
  /5 terms unstarred/.test(document.querySelector("#toast")?.textContent),
);
assert.equal(await page.locator(".study-starred").count(), 0);
assert.equal(
  await page.getByRole("button", { name: "★ Study starred" }).isDisabled(),
  true,
);
assert.deepEqual(errors, []);
await browser.close();
console.log("Study starred and selecting terms by section or one by one work.");
