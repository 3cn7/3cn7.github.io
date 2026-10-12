import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const require = createRequire(import.meta.url),
  { chromium } = require(process.env.STUDY_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.STUDY_CHROME_PATH || undefined,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1050 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://127.0.0.1:8765/");
await page.waitForSelector("h1");
console.log("Loaded", await page.locator("h1").textContent());
await mkdir("test-results", { recursive: true });
await page.screenshot({
  path: "test-results/redesign-dashboard.png",
  fullPage: true,
});
for (const width of [360, 390, 768, 1024, 1280, 1440, 1920]) {
  await page.setViewportSize({ width, height: 1050 });
  for (const route of [
    "dashboard",
    "library",
    "transcripts",
    "statistics",
    "settings",
  ]) {
    await page.goto("http://127.0.0.1:8765/#" + route);
    await page.waitForSelector("h1");
    await page.waitForTimeout(80);
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    assert(!over, `${route} overflows at ${width}`);
  }
  console.log("Width passed", width);
}
await page.setViewportSize({ width: 1440, height: 1050 });
await page.goto("http://127.0.0.1:8765/#settings");
await page.getByLabel("Theme", { exact: true }).selectOption("dark");
await page.getByRole("button", { name: "Save settings" }).click();
await page.reload();
await page.waitForSelector("h1");
assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
await page.goto("http://127.0.0.1:8765/#dashboard");
await page.screenshot({
  path: "test-results/redesign-dark.png",
  fullPage: true,
});
await page.goto("http://127.0.0.1:8765/#settings");
await page.getByLabel("Theme", { exact: true }).selectOption("system");
await page.getByRole("button", { name: "Save settings" }).click();
await page.emulateMedia({ colorScheme: "light" });
assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
await page.emulateMedia({ colorScheme: "dark" });
await page.waitForFunction(
  () => document.documentElement.dataset.theme === "dark",
);
await page.getByRole("button", { name: "Open study timer" }).click();
await page.getByLabel("Hours", { exact: true }).fill("0");
await page.getByLabel("Minutes", { exact: true }).fill("0");
await page.getByLabel("Seconds", { exact: true }).fill("3");
await page.locator("#timer-s").blur();
await page.locator("#timerStart").click();
await page.goto("http://127.0.0.1:8765/#library");
await page.reload();
await page.waitForTimeout(3200);
assert.match(await page.locator("#timerNote").textContent(), /Time is up/);
await page.locator("#timerMode").selectOption("stopwatch");
await page.locator("#timerStart").click();
await page.waitForTimeout(1200);
await page.locator("#timerStart").click();
const value = await page.locator("#timerReadout").textContent();
await page.waitForTimeout(1200);
assert.equal(await page.locator("#timerReadout").textContent(), value);
await page.locator("#timerStart").click();
await page.waitForTimeout(1200);
assert.notEqual(await page.locator("#timerReadout").textContent(), value);
await page.locator("#timerStart").click();
await page.locator("#timerMode").selectOption("countdown");
await page.getByLabel("Seconds", { exact: true }).fill("3");
await page.locator("#timer-s").blur();
await page.locator("#timerStart").click();
const background = await page.context().newPage();
await background.goto("http://127.0.0.1:8765/#library");
await background.bringToFront();
const suspension = await page.context().newCDPSession(page);
await suspension.send("Page.setWebLifecycleState", { state: "frozen" });
await background.waitForTimeout(3500);
await suspension.send("Page.setWebLifecycleState", { state: "active" });
await page.bringToFront();
await page.waitForFunction(() =>
  document.querySelector("#timerNote")?.textContent.includes("Time is up"),
);
await background.close();
assert.deepEqual(errors, []);
console.log(
  "Themes, seven widths, persistent countdown, stopwatch pause passed.",
);
await browser.close();
