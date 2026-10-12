import { createRequire } from "node:module";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url),
  { chromium } = require(process.env.STUDY_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.STUDY_CHROME_PATH || undefined,
  }),
  page = await browser.newPage({ viewport: { width: 390, height: 844 } }),
  errors = [];
page.on("pageerror", (e) => {
  errors.push(e.message);
  console.log("Page error", e.message);
});
page.on("console", (m) => {
  if (m.type() === "error") console.log(m.text());
});
try {
  await page.goto("http://127.0.0.1:8765/#transcripts");
  await page.waitForSelector("h1");
  const tid = await page.evaluate(async () => {
    const { Store } = await import("./assets/persistence.js"),
      { record } = await import("./assets/core.js"),
      s = await new Store().open();
    const t = record("transcript", {
      title: "Sicilia",
      rawText: "La Sicilia è una regione nel sud dell’Italia.",
      editedText: "La Sicilia è una regione nel sud dell’Italia.",
      segments: [
        {
          id: "seg-1",
          start: 0,
          end: 8,
          originalText: "La Sicilia è una regione nel sud dell’Italia.",
          text: "La Sicilia è una regione nel sud dell’Italia.",
          sourceLanguage: "it",
          translatedText: "Sicily is a region in southern Italy.",
          targetLanguage: "en",
          translationStatus: "done",
        },
      ],
      editHistory: [],
    });
    await s.put(t);
    return t.id;
  });
  await page.goto("http://127.0.0.1:8765/#transcripts/" + tid);
  await page.waitForSelector("[data-segment-edit]");
  await page
    .locator("[data-field=text]")
    .fill(
      "La Sicilia è una regione nel sud dell’Italia. Palermo è la capitale.",
    );
  await page
    .locator("[data-field=translatedText]")
    .fill("Sicily is a region in southern Italy. Palermo is the capital.");
  await page
    .getByRole("button", { name: "Save transcript", exact: true })
    .click();
  await page.waitForFunction(() =>
    document.querySelector("#toast")?.textContent.includes("Transcript saved."),
  );
  await page.reload();
  await page.waitForSelector("[data-segment-edit]");
  assert.match(await page.locator("[data-field=text]").inputValue(), /Palermo/);
  assert.match(
    await page.locator("[data-field=translatedText]").inputValue(),
    /capital/,
  );
  const saved = await page.evaluate(async (tid) => {
    const { Store } = await import("./assets/persistence.js"),
      s = await new Store().open();
    return s.get(tid);
  }, tid);
  assert.equal(saved.rawText, "La Sicilia è una regione nel sud dell’Italia.");
  assert(saved.editHistory.length);
  assert.equal(saved.segments[0].translationStatus, "edited");
  await page
    .getByRole("button", { name: "Create flashcards", exact: true })
    .click();
  await page.waitForSelector("#draftRows");
  assert.equal(await page.locator("#draftRows article").count(), 1);
  await page.locator("[name=term-0]").fill("La Sicilia");
  await page
    .locator("[name=definition-0]")
    .fill("Una regione nel sud dell’Italia.");
  await page
    .getByRole("button", { name: "Save approved cards", exact: true })
    .click();
  await page.waitForURL("**/#set/*");
  const card = await page.evaluate(async () => {
    const { Store } = await import("./assets/persistence.js"),
      s = await new Store().open();
    return s.list("card")[0];
  });
  assert.equal(card.provenance.transcriptId, tid);
  assert.equal(card.provenance.segmentId, "seg-1");
  await page.getByRole("link", { name: /Source transcript/ }).click();
  await page.waitForSelector("[data-segment-edit]");
  assert(
    !(await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    )),
  );
  await page.goto("http://127.0.0.1:8765/#transcripts");
  await page
    .getByRole("button", { name: "Create cards from notes", exact: true })
    .click();
  await page
    .locator("[name=notes]")
    .fill(
      "Mitosis: division into two identical cells.\nPhotosynthesis: plants convert light into chemical energy.",
    );
  await page
    .getByRole("button", { name: "Create suggestions", exact: true })
    .click();
  await page.waitForSelector("#draftRows");
  assert.equal(await page.locator("#draftRows article").count(), 2);
  await page.getByLabel("Accept suggestion 2", { exact: true }).uncheck();
  await page
    .getByRole("button", { name: "Save approved cards", exact: true })
    .click();
  await page.waitForURL("**/#set/*");
  assert.equal(await page.locator(".card-row").count(), 1);
  assert.deepEqual(errors, []);
  console.log(
    "Local notes extraction, reviewed card approval, Unicode edits/history, translations and transcript provenance passed on mobile.",
  );
} finally {
  await browser.close();
}
