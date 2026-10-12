import { createRequire } from "node:module";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url),
  { chromium } = require(process.env.STUDY_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.STUDY_CHROME_PATH || undefined,
});
const page = await browser.newPage();
try {
  await page.goto("http://127.0.0.1:8765/");
  await page.waitForSelector("h1");
  const before = await page.evaluate(async () => {
    const { Store } = await import("./assets/persistence.js"),
      { record, createStudySet, createFlashcard } = await import(
        "./assets/core.js"
      );
    const s = await new Store().open(),
      folder = record("folder", { name: "Italian", parentId: null }),
      set = createStudySet({
        title: "Migration specimen",
        folderId: folder.id,
      }),
      card = createFlashcard(set.id, {
        term: "la città",
        definition: "the city",
        starred: true,
      });
    await s.putMany([folder, set, card]);
    localStorage.setItem(
      "retiredTracker.data",
      JSON.stringify({ historical: ["do not delete"] }),
    );
    localStorage.setItem(
      "retiredTracker.preferences",
      JSON.stringify({ clientId: "123-example.apps.googleusercontent.com" }),
    );
    localStorage.setItem(
      "retiredTracker.timer",
      JSON.stringify({
        durationMs: 300000,
        remainingMs: 200000,
        endsAt: 0,
        running: false,
      }),
    );
    await s.meta("studyOnlyMigration", null);
    return s.records;
  });
  await page.reload();
  await page.waitForSelector("h1");
  const result = await page.evaluate(async () => {
    const { Store } = await import("./assets/persistence.js");
    const s = await new Store().open();
    return {
      records: s.records,
      backup: await s.meta("beforeStudyOnlyMigration"),
      retired: localStorage.getItem("retiredTracker.data"),
      client: localStorage.getItem("studyPlatform.oauthClientId"),
      timer: JSON.parse(localStorage.getItem("studyPlatform.timer.v2")),
    };
  });
  assert.deepEqual(result.records, before);
  assert.deepEqual(result.backup.study.records, before);
  assert(result.backup.localStorage["retiredTracker.data"]);
  assert(result.retired.includes("do not delete"));
  assert.equal(result.client, "123-example.apps.googleusercontent.com");
  assert.equal(result.timer.durationMs, 300000);
  await page.evaluate(async () => {
    const { Store } = await import("./assets/persistence.js");
    const a = await new Store().open(),
      b = await new Store().open(),
      card = a.list("card")[0],
      stale = structuredClone(card);
    await b.update(card.id, (r) => ({ ...r, notes: "newer edit" }));
    let rejected = false;
    try {
      await a.put({ ...stale, definition: "stale value" });
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error("Stale write accepted");
    await a.refresh();
    if (a.get(card.id).notes !== "newer edit")
      throw new Error("Newer edit lost");
  });
  assert.equal(await page.locator("iframe").count(), 0);
  await page.goto("http://127.0.0.1:8765/sat.html");
  assert.equal(await page.locator("h1").textContent(), "Error response");
  console.log(
    "Migration backup, unchanged records and retired keys, shared preference extraction, stale-write guard, and removed route passed.",
  );
} finally {
  await browser.close();
}
