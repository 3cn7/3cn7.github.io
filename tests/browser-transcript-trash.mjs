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
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const APP = "http://127.0.0.1:8765/";
await page.goto(APP + "#library");
await page.waitForSelector("h1");
const id = await page.evaluate(async () => {
  const { Store } = await import("./assets/persistence.js"),
    { record } = await import("./assets/core.js");
  const s = await new Store().open();
  await s.saveAudio(
    "rec1",
    new Blob([new Uint8Array(2000)], { type: "audio/wav" }),
    {},
  );
  const t = record("transcript", {
    title: "Lezione",
    rawText: "ciao",
    editedText: "ciao",
    segments: [],
    provider: "browser-local",
    audioId: "rec1",
  });
  await s.putMany([t]);
  s.channel?.close();
  s.db.close();
  return t.id;
});
const audio = () =>
  page.evaluate(async () => {
    const { Store } = await import("./assets/persistence.js");
    const s = await new Store().open(),
      a = await s.audio("rec1");
    s.channel?.close();
    s.db.close();
    return !!a;
  });
await page.goto(APP + "#transcripts/" + id);
await page.getByText("More", { exact: true }).first().click();
await page.getByRole("button", { name: "Move to trash" }).click();
assert.match(
  await page.locator("#modal").innerText(),
  /transcript and its recording move to Recently Deleted/,
);
await page
  .getByRole("button", { name: "Move to trash", exact: true })
  .last()
  .click();
await page.waitForURL("**/#transcripts");
assert.equal(await page.locator(".transcript-list-row").count(), 0);
assert.equal(
  await audio(),
  true,
  "the recording is kept while the transcript is in the trash",
);
await page.getByRole("button", { name: "Back to Dashboard" }).count();
await page.goto(APP + "#settings");
await page
  .getByRole("button", { name: "Recently deleted", exact: true })
  .click();
assert.match(
  await page.locator("#modal").innerText(),
  /Lezione[\s\S]*transcript with recording/,
);
await page.getByRole("button", { name: "Restore", exact: true }).click();
await page.getByRole("button", { name: "Close dialog" }).click();
await page.goto(APP + "#transcripts");
await page.waitForSelector(".transcript-list-row");
// Trash again and erase for good: the recording goes too.
await page.goto(APP + "#transcripts/" + id);
await page.getByText("More", { exact: true }).first().click();
await page.getByRole("button", { name: "Move to trash" }).click();
await page
  .getByRole("button", { name: "Move to trash", exact: true })
  .last()
  .click();
await page.waitForURL("**/#transcripts");
await page.goto(APP + "#settings");
await page
  .getByRole("button", { name: "Recently deleted", exact: true })
  .click();
await page.getByRole("button", { name: "Permanently erase" }).click();
await page
  .getByRole("button", { name: "Erase permanently", exact: true })
  .click();
await page.waitForFunction(
  () => !/Lezione/.test(document.querySelector("#modal")?.innerText || ""),
);
assert.equal(await audio(), false);
assert.deepEqual(errors, []);
await browser.close();
console.log(
  "Transcripts move to the trash with their recording, restore intact, and erasing removes the recording.",
);
