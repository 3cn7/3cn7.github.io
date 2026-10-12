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
    { createStudySet } = await import("./assets/core.js");
  const s = await new Store().open();
  await s.putMany([createStudySet({ title: "Click me" })]);
  s.channel?.close();
  s.db.close();
});
await page.reload();
await page.waitForSelector(".set-tile");
assert.equal(await page.getByRole("link", { name: "Open set →" }).count(), 0);
await page.getByLabel("Select Click me").check();
assert.equal(
  await page.locator(".set-tile.is-selected").count(),
  1,
  "checkbox still works",
);
await page.locator(".set-tile").click({ position: { x: 40, y: 140 } });
await page.waitForURL("**/#set/*");
await browser.close();
console.log(
  "Clicking anywhere on a set card opens it; its controls still work.",
);
