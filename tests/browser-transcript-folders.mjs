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
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://127.0.0.1:8765/#library");
await page.waitForSelector("h1");
await page.evaluate(async () => {
  const { Store } = await import("./assets/persistence.js"),
    { record } = await import("./assets/core.js");
  const s = await new Store().open();
  await s.putMany([
    record("folder", { name: "Lectures", parentId: null }),
    record("transcript", {
      title: "Lezione uno",
      rawText: "ciao",
      editedText: "ciao",
      segments: [],
      provider: "browser-local",
    }),
  ]);
  s.channel?.close();
  s.db.close();
});
const folderOf = () =>
  page.evaluate(async () => {
    const { Store } = await import("./assets/persistence.js");
    const s = await new Store().open(),
      t = s.list("transcript")[0],
      f = s.list("folder")[0];
    s.channel?.close();
    s.db.close();
    return { inFolder: t.folderId === f.id, none: !t.folderId };
  });
await page.reload();
await page.waitForSelector(".transcript-row");
// Drag onto a folder
await page
  .locator(".transcript-row")
  .dragTo(page.locator(".folder-card", { hasText: "Lectures" }));
await page.waitForFunction(() => !document.querySelector(".transcript-row"));
assert.equal((await folderOf()).inFolder, true);
await page.getByRole("link", { name: "Lectures", exact: true }).click();
await page.waitForSelector(".transcript-row");
// Move out with the dialog (no dragging)
await page.getByRole("button", { name: /Move transcript Lezione uno/ }).click();
await page.getByLabel("Destination folder").selectOption("");
await page.getByRole("button", { name: "Move here", exact: true }).click();
await page.waitForFunction(() => !document.querySelector(".transcript-row"));
assert.equal((await folderOf()).none, true);
// Tree view shows it, and the transcript page can move it
await page.goto("http://127.0.0.1:8765/#library");
await page.getByRole("button", { name: "Folder tree", exact: true }).click();
await page.locator("[role=treeitem][data-kind=transcript]").waitFor();
// A transcript inside a folder stays visible in the tree.
await page.getByRole("button", { name: "Grid", exact: true }).click();
await page
  .locator(".transcript-row")
  .dragTo(page.locator(".folder-card", { hasText: "Lectures" }));
await page.waitForFunction(() => !document.querySelector(".transcript-row"));
await page.getByRole("button", { name: "Folder tree", exact: true }).click();
const inFolder = page.locator(
  '[role=treeitem][data-label="Lectures"] [data-kind=transcript]',
);
await inFolder.waitFor();
await inFolder.click();
await page.getByRole("button", { name: "Move to…" }).click();
await page.getByLabel("Destination folder").selectOption("");
await page.getByRole("button", { name: "Move here", exact: true }).click();
await page.locator("#libraryTree > [data-kind=transcript]").waitFor();
await page.locator("[role=treeitem][data-kind=transcript]").dblclick();
await page.waitForURL("**/#transcripts/*");
await page.getByText("More", { exact: true }).first().click();
await page.getByRole("button", { name: "Move to folder…" }).click();
await page.getByLabel("Destination folder").selectOption({ label: "Lectures" });
await page.getByRole("button", { name: "Move here", exact: true }).click();
await page.waitForFunction(async () => true);
await page.waitForTimeout(300);
assert.equal((await folderOf()).inFolder, true);
assert.deepEqual(errors, []);
await browser.close();
console.log(
  "Transcripts can be dragged or moved into folders and shown in grid and tree views.",
);
