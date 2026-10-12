// The padlock: new browsers must enter the password once; existing users and unlocked browsers never do.
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
const APP = "http://127.0.0.1:8765/?gate=on#library";
// A brand-new visitor.
const context = await browser.newContext();
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(APP);
await page.locator(".lock-screen").waitFor();
assert.equal(
  await page.locator(".sidebar").isVisible(),
  false,
  "the app is hidden behind the lock",
);
assert.equal(
  await page.evaluate(() => !!localStorage.getItem("studyPlatform.device")),
  false,
  "no data is opened before unlocking",
);
await page.locator("#lockPassword").fill("not the password");
await page.getByRole("button", { name: "Unlock" }).click();
await page.locator("#lockError:not([hidden])").waitFor();
assert.equal(await page.locator(".lock-screen").count(), 1);
await page.locator("#lockPassword").fill("1qaz2wsx3edc4rfv");
await page.getByRole("button", { name: "Unlock" }).click();
await page.locator(".lock-screen").waitFor({ state: "detached" });
await page.waitForSelector("#view h1");
assert.equal(await page.locator(".lock-screen").count(), 0);
assert.equal(await page.locator(".sidebar").isVisible(), true);
// Reloading never asks again.
await page.reload();
await page.waitForSelector("#view h1");
assert.equal(await page.locator(".lock-screen").count(), 0);
await page.close();
// Someone who already used the site in this browser (it has a device ID) is not asked.
const returning = await (await browser.newContext()).newPage();
await returning.addInitScript(() =>
  localStorage.setItem("studyPlatform.device", "existing-device"),
);
await returning.goto(APP);
await returning.waitForSelector("#view h1");
assert.equal(await returning.locator(".lock-screen").count(), 0);
assert.equal(
  await returning.evaluate(() => localStorage.getItem("studyPlatform.access")),
  "granted",
);
// The password itself is not shipped in the page code.
const source = await (
  await fetch("http://127.0.0.1:8765/assets/gate.js")
).text();
assert(!source.includes("1qaz2wsx3edc4rfv"));
assert.deepEqual(errors, []);
await browser.close();
console.log(
  "The padlock asks new visitors once, never asks returning users, and ships only a hash.",
);
