// Revisions from another device hold the screen (solid grey, spreading cards) until they are applied.
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
await page.goto("http://127.0.0.1:8765/#dashboard");
await page.waitForSelector("#greeting");
assert.equal(await page.locator(".sync-overlay").count(), 0);
await page.evaluate(() =>
  window.studyroomSync.dispatchEvent(new CustomEvent("incoming")),
);
const overlay = page.locator("dialog.sync-overlay");
await overlay.waitFor();
assert.equal(await overlay.evaluate((d) => d.open), true);
assert.match(await overlay.innerText(), /Syncing/);
assert.equal(
  await page.locator(".sync-card").count(),
  3,
  "the streak card design, three of them",
);
// Solid colour that fully covers the page.
const look = await overlay.evaluate((d) => {
  const s = getComputedStyle(d),
    r = d.getBoundingClientRect();
  return {
    bg: s.backgroundColor,
    covers: r.width >= innerWidth && r.height >= innerHeight,
  };
});
assert.equal(look.covers, true);
assert.match(
  look.bg,
  /^rgb\(\d+, \d+, \d+\)$/,
  "an opaque colour, not translucent",
);
// The cards spread: they are at different places a moment later.
const x = () =>
  page.locator(".sync-card.c1").evaluate((c) => c.getBoundingClientRect().left);
const a = await x();
await page.waitForTimeout(1100);
assert.notEqual(
  Math.round(a),
  Math.round(await x()),
  "the cards are animating",
);
// Nothing underneath can be used, by mouse or keyboard.
assert.equal(
  await page.evaluate(
    () =>
      document.elementFromPoint(40, 200)?.closest("dialog.sync-overlay") !==
      null,
  ),
  true,
);
await page.keyboard.press("Escape");
assert.equal(
  await overlay.evaluate((d) => d.open),
  true,
  "Escape does not dismiss it",
);
await page.keyboard.press("Tab");
assert.equal(
  await page.evaluate(
    () =>
      document.activeElement?.closest("dialog.sync-overlay") !== null ||
      document.activeElement === document.body,
  ),
  true,
);
// It ends when the work ends (after a minimum time so it never flashes).
await page.evaluate(() =>
  window.studyroomSync.dispatchEvent(
    new CustomEvent("incomingEnd", { detail: { ok: true } }),
  ),
);
await page
  .locator("dialog.sync-overlay")
  .waitFor({ state: "detached", timeout: 5000 });
await page.waitForFunction(() =>
  /Updated from another device/.test(
    document.querySelector("#toast")?.textContent,
  ),
);
assert.equal(
  await page.locator("#greeting").count(),
  1,
  "the page works again",
);
await page.getByRole("button", { name: "Timer" }).click();
assert.equal(await page.locator("#timerPanel").isVisible(), true);
assert.deepEqual(errors, []);
await browser.close();
console.log(
  "Another device's changes hold the screen with a solid cover and animated cards until they finish.",
);
