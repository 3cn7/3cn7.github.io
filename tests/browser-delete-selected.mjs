// Deleting selected sets needs two confirmations and is recoverable.
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
const page = await browser.newPage();
await page.goto("http://127.0.0.1:8765/#library");
await page.waitForSelector("h1");
await page.evaluate(async () => {
  const { Store } = await import("./assets/persistence.js"),
    { createStudySet, createFlashcard } = await import("./assets/core.js");
  const s = await new Store().open(),
    rows = [];
  for (const t of ["Keep", "Gone A", "Gone B"]) {
    const set = createStudySet({ title: t });
    rows.push(
      set,
      createFlashcard(set.id, { term: "x" + t, definition: "y" }, 0),
    );
  }
  await s.putMany(rows);
  s.channel?.close();
  s.db.close();
});
await page.reload();
await page.waitForSelector(".set-tile");
assert.equal(
  await page.getByRole("button", { name: "Delete selected…" }).count(),
  0,
);
await page.getByLabel("Select Gone A", { exact: true }).check();
await page.getByLabel("Select Gone B", { exact: true }).check();
await page.getByRole("button", { name: "Delete selected…" }).click();
await page.getByRole("button", { name: "Continue", exact: true }).click();
await page.getByRole("heading", { name: /step 2 of 2/ }).waitFor();
await page.locator("#modal [name=word]").fill("delete");
await page.getByRole("button", { name: "Delete sets", exact: true }).click();
await page.waitForSelector("#modalError:not([hidden])");
assert.equal(
  await page.locator(".set-tile").count(),
  3,
  "wrong word deletes nothing",
);
await page.locator("#modal [name=word]").fill("DELETE");
await page.getByRole("button", { name: "Delete sets", exact: true }).click();
await page.waitForFunction(
  () => document.querySelectorAll(".set-tile").length === 1,
);
assert.equal(await page.locator(".set-title").textContent(), "Keep");
const deleted = await page.evaluate(async () => {
  const { Store } = await import("./assets/persistence.js");
  const s = await new Store().open();
  return s.records.filter((r) => r.deleted).length;
});
assert.equal(deleted, 4, "two sets and their cards are in Recently Deleted");
await browser.close();
console.log(
  "Delete selected asks twice (summary, then typed DELETE) and is recoverable.",
);
