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
await page.goto("http://127.0.0.1:8765/#library");
await page.waitForSelector("h1");
await page.evaluate(async () => {
  const { Store } = await import("./assets/persistence.js"),
    { record } = await import("./assets/core.js");
  const s = await new Store().open();
  await s.putMany([record("folder", { name: "Big folder", parentId: null })]);
  s.channel?.close();
  s.db.close();
});
await page.reload();
const card = page.locator(".folder-card");
await card.waitFor();
const box = await card.boundingBox();
// Click the empty right-hand part of the card, far from the folder name.
await page.mouse.click(box.x + box.width - 20, box.y + 20);
await page.waitForURL("**/#folder/*");
await page.goto("http://127.0.0.1:8765/#library");
await card.getByRole("button", { name: /Edit folder/ }).click();
assert.equal(await page.locator("#modal[open]").count(), 1, "Edit still works");
await browser.close();
console.log(
  "Clicking anywhere on a folder card opens it; Edit and Move still work.",
);
