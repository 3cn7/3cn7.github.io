// A set's card in the Study Library offers "Continue where I left off" when a session is unfinished.
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
const APP = "http://127.0.0.1:8765/";
await page.goto(APP + "#library");
await page.waitForSelector("h1");
const id = await page.evaluate(async () => {
  const { Store } = await import("./assets/persistence.js"),
    { createStudySet, createFlashcard } = await import("./assets/core.js");
  const s = await new Store().open(),
    set = createStudySet({ title: "Resume me" });
  await s.putMany([
    set,
    ...["a", "b", "c"].map((w, i) =>
      createFlashcard(set.id, { term: w, definition: "d" + w }, i),
    ),
  ]);
  s.channel?.close();
  s.db.close();
  return set.id;
});
await page.goto(APP + "#set/" + id);
await page.getByRole("button", { name: "Flashcards", exact: true }).click();
await page.getByRole("button", { name: "Start studying", exact: true }).click();
await page.waitForSelector(".study-card");
await page.getByRole("button", { name: "Next flashcard" }).click();
await page.getByRole("button", { name: "Save & exit", exact: true }).click();
await page.waitForURL("**/#library");
await page.getByRole("button", { name: /Continue where I left off/ }).click();
await page.waitForURL("**/#study/*");
await page.waitForFunction(() =>
  /2 \/ 3/.test(document.querySelector(".study-controls span")?.textContent),
);
await browser.close();
console.log(
  "Set cards offer Continue where I left off and resume at the saved card.",
);
