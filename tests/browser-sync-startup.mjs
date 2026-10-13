// The screen is held with "Syncing" when the site opens with Drive sync on, and every hour a check
// for revisions from other devices queues the same animation when it finds any.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { makeBackup, createStudySet } from "../assets/core.js";
const require = createRequire(import.meta.url),
  { chromium } = require(process.env.STUDY_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.STUDY_CHROME_PATH
    ? { executablePath: process.env.STUDY_CHROME_PATH }
    : {}),
});
const APP = "http://127.0.0.1:8765/";
const otherSet = createStudySet({
  title: "Written on another device",
  clock: { phone: 1 },
});
const drive = { files: [], delay: 0, listed: 0 };
async function fakeGoogle(context) {
  await context.route("https://accounts.google.com/gsi/client", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `window.google={accounts:{oauth2:{initTokenClient:(c)=>({requestAccessToken:()=>setTimeout(()=>c.callback({access_token:"t",expires_in:3600}),50)})}}}`,
    }),
  );
  await context.route("https://www.googleapis.com/**", async (route) => {
    const url = route.request().url(),
      cors = { "access-control-allow-origin": "*" };
    if (route.request().method() === "POST")
      return route.fulfill({
        contentType: "application/json",
        headers: cors,
        body: JSON.stringify({ id: "own-" + Math.random() }),
      });
    if (url.includes("alt=media"))
      return route.fulfill({
        contentType: "application/json",
        headers: cors,
        body: JSON.stringify(makeBackup([otherSet])),
      });
    drive.listed++;
    await new Promise((r) => setTimeout(r, drive.delay));
    return route.fulfill({
      contentType: "application/json",
      headers: cors,
      body: JSON.stringify({ files: drive.files }),
    });
  });
}
async function sync(page) {
  await page.goto(APP + "#dashboard");
  await page.waitForSelector("#view h1");
  await page.evaluate(async () => {
    localStorage.setItem(
      "studyPlatform.oauthClientId",
      "test.apps.googleusercontent.com",
    );
    const { Store } = await import("./assets/persistence.js");
    const s = await new Store().open();
    await s.meta("driveEnabled", true);
    s.channel?.close();
    s.db.close();
  });
}
// ----- opening the site
{
  const context = await browser.newContext();
  await fakeGoogle(context);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await sync(page);
  drive.delay = 1200;
  drive.files = [];
  await page.reload();
  const overlay = page.locator("dialog.sync-overlay");
  await overlay.waitFor({ timeout: 3000 });
  assert.match(await overlay.innerText(), /Syncing/);
  assert.equal(await overlay.evaluate((d) => d.open), true);
  await overlay.waitFor({ state: "detached", timeout: 10000 });
  await page.waitForSelector("#greeting");
  assert.equal(
    await page.locator("#toast:not([hidden])").count(),
    0,
    "nothing new, so no announcement",
  );
  assert.deepEqual(errors, []);
  await context.close();
}
// ----- the hourly check
{
  const context = await browser.newContext();
  await fakeGoogle(context);
  const page = await context.newPage();
  await page.clock.install();
  await sync(page);
  drive.delay = 0;
  drive.files = [];
  await page.reload();
  await page.waitForSelector("#greeting");
  await page.clock.runFor(3000);
  const quiet = drive.listed;
  // Nothing happens before the hour is up.
  await page.clock.fastForward("30:00");
  assert.equal(await page.locator("dialog.sync-overlay").count(), 0);
  // Another device has written a revision; the hourly check finds it and holds the screen.
  drive.files = [{ id: "revision-from-phone" }];
  await page.clock.fastForward("31:00");
  await page.locator("dialog.sync-overlay").waitFor({ timeout: 5000 });
  assert.equal(drive.listed > quiet, true);
  await page.clock.runFor(3000);
  await page
    .locator("dialog.sync-overlay")
    .waitFor({ state: "detached", timeout: 5000 });
  await page.waitForFunction(() =>
    /Updated from another device/.test(
      document.querySelector("#toast")?.textContent,
    ),
  );
  const merged = await page.evaluate(async () => {
    const { Store } = await import("./assets/persistence.js");
    const s = await new Store().open(),
      r = s.list("set").some((x) => x.title === "Written on another device");
    s.channel?.close();
    s.db.close();
    return r;
  });
  assert.equal(merged, true, "the other device's set was merged");
  await context.close();
}
await browser.close();
console.log(
  "The site opens with a Syncing screen when Drive is on, and an hourly check queues it when another device wrote revisions.",
);
