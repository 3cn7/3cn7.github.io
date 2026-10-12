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
const APP = "http://127.0.0.1:8765/";
await page.goto(APP + "#library");
await page.waitForSelector("h1");
// Empty top level: no empty-state box and no bulk-action row.
assert.equal(await page.locator(".empty").count(), 0);
assert.equal(await page.locator("#setCount").count(), 0);
assert.equal(
  await page.getByRole("button", { name: "Study starred terms" }).count(),
  0,
  "not at the top level",
);
assert.equal(
  await page
    .getByRole("button", { name: "Recently deleted", exact: true })
    .count(),
  1,
  "only at the top level",
);
await page.evaluate(async () => {
  const { Store } = await import("./assets/persistence.js"),
    { record } = await import("./assets/core.js");
  const s = await new Store().open();
  await s.putMany([record("folder", { name: "Inner", parentId: null })]);
  s.channel?.close();
  s.db.close();
});
await page.reload();
await page.getByRole("link", { name: "Inner", exact: true }).click();
await page.waitForURL("**/#folder/*");
await page.getByRole("button", { name: "Study starred terms" }).waitFor();
assert.equal(
  await page.getByRole("button", { name: "Recently deleted" }).count(),
  0,
  "not inside folders",
);
await browser.close();
console.log(
  "Top level hides the empty box and starred button; Recently deleted only at the top level.",
);
