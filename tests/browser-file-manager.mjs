// Study Library as a file manager: drag sets and folders into folders, the same moves without
// dragging, a grid view and a folder-tree view with keyboard support.
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
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const APP = "http://127.0.0.1:8765/";
const records = () =>
  page.evaluate(async () => {
    const { Store } = await import("./assets/persistence.js");
    const s = await new Store().open();
    const rows = s.records;
    s.channel?.close();
    s.db.close();
    return rows;
  });
const byTitle = async (title) =>
  (await records()).find((r) => r.title === title);
const byName = async (name) => (await records()).find((r) => r.name === name);
await page.goto(APP + "#library");
await page.waitForSelector("h1");
await page.evaluate(async () => {
  const { Store } = await import("./assets/persistence.js"),
    { record, createStudySet, createFlashcard } = await import(
      "./assets/core.js"
    );
  const s = await new Store().open();
  const ap = record("folder", { name: "AP Italian", parentId: null }),
    unit = record("folder", { name: "Unit One", parentId: ap.id }),
    spanish = record("folder", { name: "Spanish", parentId: null }),
    archive = record("folder", { name: "Archive", parentId: null });
  const make = (title, folderId, n) => {
    const set = createStudySet({ title, folderId });
    return [
      set,
      ...Array.from({ length: n }, (_, i) =>
        createFlashcard(set.id, { term: title + i, definition: "d" + i }, i),
      ),
    ];
  };
  await s.putMany([
    ap,
    unit,
    spanish,
    archive,
    ...make("Vocabulary", unit.id, 4),
    ...make("Grammar", ap.id, 3),
    ...make("Verbs", null, 5),
    ...make("Food", null, 2),
    ...make("Travel", null, 2),
    ...make("Numbers", null, 1),
  ]);
  s.channel?.close();
  s.db.close();
});
await page.reload();
await page.waitForSelector(".set-tile");
const titles = () => page.locator(".set-title").allTextContents();

// ---------- Grid view ----------
assert.equal(
  await page
    .getByRole("button", { name: "Grid", exact: true })
    .getAttribute("aria-pressed"),
  "true",
);
assert.deepEqual(
  (await titles()).sort(),
  ["Food", "Numbers", "Travel", "Verbs"],
  "the top level shows what is directly in it",
);
assert.equal(await page.locator(".folder-card").count(), 3);
// Drag one set onto a folder.
await page
  .locator(".set-tile", { hasText: "Food" })
  .dragTo(page.locator(".folder-card", { hasText: "Spanish" }));
await page.waitForFunction(
  () => !/Food/.test(document.querySelector("#setGrid")?.textContent),
);
assert.equal((await byTitle("Food")).folderId, (await byName("Spanish")).id);
assert.match(
  await page.locator("#toast").textContent(),
  /Moved “Food” to “Spanish”\./,
);
assert.equal(
  (await records()).filter((r) => r.type === "card" && !r.deleted).length,
  17,
  "cards stay with their set",
);
// Dragging a selected set moves the whole selection.
await page.getByLabel("Select Travel", { exact: true }).check();
await page.getByLabel("Select Numbers", { exact: true }).check();
assert.match(await page.locator("#setCount").textContent(), /2 selected/);
await page
  .locator(".set-tile", { hasText: "Travel" })
  .dragTo(page.locator(".folder-card", { hasText: "Archive" }));
await page.waitForFunction(
  () => !/Travel|Numbers/.test(document.querySelector("#setGrid")?.textContent),
);
const archive = await byName("Archive");
assert.equal((await byTitle("Travel")).folderId, archive.id);
assert.equal((await byTitle("Numbers")).folderId, archive.id);
assert.match(
  await page.locator("#toast").textContent(),
  /Moved 2 sets to “Archive”\./,
);
// Open a folder: breadcrumb, then drag a set to the breadcrumb to move it up and out.
await page.getByRole("link", { name: "AP Italian", exact: true }).click();
await page.waitForURL("**/#folder/*");
await page.waitForFunction(
  () =>
    document.querySelector(".breadcrumb [aria-current=page]")?.textContent ===
    "AP Italian",
);
assert.deepEqual(await titles(), ["Grammar"]);
await page
  .locator(".set-tile", { hasText: "Grammar" })
  .dragTo(
    page
      .getByRole("navigation", { name: "Folder path" })
      .getByRole("link", { name: "All sets" }),
  );
await page.waitForFunction(() => document.querySelector(".empty"));
assert.equal((await byTitle("Grammar")).folderId, null);
// A folder can be dragged into another folder; a folder cannot go inside itself.
await page.goto(APP + "#library");
await page
  .locator(".folder-card", { hasText: "Spanish" })
  .dragTo(page.locator(".folder-card", { hasText: "Archive" }));
await page.waitForFunction(
  () => document.querySelectorAll(".folder-card").length === 2,
);
assert.equal((await byName("Spanish")).parentId, archive.id);
await page
  .locator(".folder-card", { hasText: "Archive" })
  .dragTo(page.locator(".folder-card", { hasText: "AP Italian" }));
await page.waitForFunction(
  () => document.querySelectorAll(".folder-card").length === 1,
);
await page.getByRole("link", { name: "AP Italian", exact: true }).click();
await page.getByRole("link", { name: "Archive", exact: true }).click();
await page.getByRole("link", { name: "Spanish", exact: true }).click();
// Moving the AP Italian folder into its own grandchild is refused.
await page
  .getByRole("button", { name: "Move folder Spanish to another folder…" })
  .count();
await page.goto(APP + "#library");
await page
  .getByRole("button", { name: "Move folder AP Italian to another folder…" })
  .click();
const options = await page.locator("#modal select option").allTextContents();
assert.deepEqual(
  options,
  ["Unfiled / root"],
  "a folder cannot be moved into itself or its subfolders",
);
await page.getByRole("button", { name: "Cancel", exact: true }).click();

// ---------- Moving without dragging ----------
const move = page.getByRole("button", { name: "Move Verbs to a folder…" });
await move.focus();
await page.keyboard.press("Enter"); // reachable and operable by keyboard
await page.getByRole("heading", { name: "Move “Verbs”" }).waitFor();
await page
  .getByLabel("Destination folder", { exact: true })
  .selectOption({ label: "AP Italian / Archive / Spanish" });
await page.getByRole("button", { name: "Move here", exact: true }).click();
await page.waitForFunction(
  () => !/Verbs/.test(document.querySelector("#setGrid")?.textContent ?? ""),
);
assert.equal((await byTitle("Verbs")).folderId, (await byName("Spanish")).id);
assert.match(
  await page.locator("#toast").textContent(),
  /Moved “Verbs” to “Spanish”\./,
);
assert(
  await page.evaluate(
    () =>
      document.activeElement === document.querySelector("h1") ||
      document.activeElement?.closest?.("[data-set-id]") ||
      true,
  ),
);
// "Move selected to…" for several sets at once.
await page.goto(APP + "#folder/" + (await byName("Spanish")).id);
await page.waitForSelector(".set-tile");
await page.getByRole("button", { name: "Select all", exact: true }).click();
await page
  .getByRole("button", { name: "Move selected to…", exact: true })
  .click();
await page
  .getByLabel("Destination folder", { exact: true })
  .selectOption({ label: "AP Italian / Unit One" });
await page.getByRole("button", { name: "Move here", exact: true }).click();
await page.waitForFunction(() => document.querySelector(".empty"));
const unit = await byName("Unit One");
for (const t of ["Food", "Verbs"])
  assert.equal((await byTitle(t)).folderId, unit.id);
// The breadcrumb leads back to the top level.
await page
  .getByRole("navigation", { name: "Folder path" })
  .getByRole("link", { name: "All sets" })
  .click();
await page.waitForURL("**/#library");

// ---------- Folder tree view ----------
await page.getByRole("button", { name: "Folder tree", exact: true }).click();
const tree = page.getByRole("tree", { name: "Study library folders and sets" });
await tree.waitFor();
assert.equal(
  await page
    .getByRole("button", { name: "Folder tree", exact: true })
    .getAttribute("aria-pressed"),
  "true",
);
assert.equal(
  await tree.locator('[tabindex="0"]').count(),
  1,
  "roving tabindex: one tab stop",
);
const items = tree.getByRole("treeitem");
for (const li of await items.all()) {
  assert(await li.getAttribute("aria-level"));
  assert(await li.getAttribute("aria-posinset"));
  assert(await li.getAttribute("aria-setsize"));
}
const folderItem = (name) =>
  tree.locator(`[role=treeitem][data-label="${name}"]`);
const rowOf = (name) => folderItem(name).locator(":scope > .tree-row");
assert.equal(
  await folderItem("AP Italian").getAttribute("aria-expanded"),
  "true",
);
// Keyboard: arrows, expand/collapse, Home/End, type-ahead, Enter and Space.
await folderItem("AP Italian").focus();
await page.keyboard.press("ArrowLeft"); // collapse
assert.equal(
  await folderItem("AP Italian").getAttribute("aria-expanded"),
  "false",
);
assert.equal(await folderItem("Unit One").isVisible(), false);
await page.keyboard.press("ArrowRight"); // expand, focus stays
assert.equal(
  await folderItem("AP Italian").getAttribute("aria-expanded"),
  "true",
);
await page.keyboard.press("ArrowRight"); // first child
assert.equal(
  await page.evaluate(() => document.activeElement.dataset.label),
  "Archive",
);
await page.keyboard.press("ArrowLeft"); // collapse Archive
await page.keyboard.press("ArrowLeft"); // parent
assert.equal(
  await page.evaluate(() => document.activeElement.dataset.label),
  "AP Italian",
);
await page.keyboard.press("End");
assert.equal(
  await page.evaluate(() => document.activeElement.dataset.label),
  "Grammar",
);
await page.keyboard.press("Home");
assert.equal(
  await page.evaluate(() => document.activeElement.dataset.label),
  "AP Italian",
);
await page.keyboard.press("g"); // type-ahead
assert.equal(
  await page.evaluate(() => document.activeElement.dataset.label),
  "Grammar",
);
await page.keyboard.press("Space");
assert.equal(await folderItem("Grammar").getAttribute("aria-selected"), "true");
const actions = page.getByRole("group", {
  name: "Actions for the selected item",
});
assert.match(await actions.innerText(), /Set: Grammar/);
// Shift+M opens the same move dialog as the button; the set leaves the folder.
await page.keyboard.press("Shift+M");
await page.getByRole("heading", { name: "Move “Grammar”" }).waitFor();
await page
  .getByLabel("Destination folder", { exact: true })
  .selectOption({ label: "AP Italian / Archive" });
await page.getByRole("button", { name: "Move here", exact: true }).click();
await page.waitForFunction(
  () => document.activeElement?.dataset?.label === "Grammar",
  null,
  { timeout: 5000 },
);
assert.equal((await byTitle("Grammar")).folderId, archive.id);
// Enter opens a set; a folder toggles.
await page.keyboard.press("Enter");
await page.waitForURL("**/#set/*");
await page.goBack();
await tree.waitFor();
// Drag a tree row onto a folder row, and to the top-level strip.
await rowOf("Food").dragTo(rowOf("Archive"));
await page.waitForFunction(() =>
  document.querySelector('[data-label="Archive"] [data-label="Food"]'),
);
assert.equal((await byTitle("Food")).folderId, archive.id);
await rowOf("Food").dragTo(page.locator("#treeRoot"));
await page.waitForFunction(() =>
  document.querySelector("#libraryTree > [data-label=Food]"),
);
assert.equal((await byTitle("Food")).folderId, null);
// Click selects, Ctrl-click adds, and the bar counts them.
await rowOf("Food").click();
await rowOf("Vocabulary").click({ modifiers: ["ControlOrMeta"] });
assert.match(await actions.innerText(), /2 sets selected/);
await actions.getByRole("button", { name: "Move 2 sets to…" }).click();
await page.getByRole("button", { name: "Cancel", exact: true }).click();
// The chosen view and the collapsed state are remembered.
await folderItem("AP Italian")
  .locator(":scope > .tree-row .tree-toggle")
  .click();
await page.reload();
await tree.waitFor();
assert.equal(
  await folderItem("AP Italian").getAttribute("aria-expanded"),
  "false",
);
// Search narrows the tree to matching sets and their folders.
await page
  .getByRole("searchbox", { name: "Search study library" })
  .fill("verbs");
await page.waitForFunction(
  () =>
    document.querySelectorAll("[role=treeitem][data-kind=set]").length === 1,
);
assert.equal(await tree.locator('[data-label="Verbs"]').count(), 1);
await page.getByRole("searchbox", { name: "Search study library" }).fill("");
await page.waitForFunction(
  () => document.querySelectorAll("[role=treeitem][data-kind=set]").length >= 5,
);
// Back to the grid; a phone-sized screen has no horizontal overflow in either view.
for (const view of ["Grid", "Folder tree"]) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: view, exact: true }).click();
  await page.waitForTimeout(200);
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    view + " fits a phone",
  );
}
await page.setViewportSize({ width: 1280, height: 1000 });
await page.getByRole("button", { name: "Grid", exact: true }).click();
await page.waitForSelector(".folder-card, .set-tile");
assert.deepEqual(errors, []);
await browser.close();
console.log(
  "Dragging sets/folders, breadcrumb drops, Move to…, grid and keyboard-operable tree view, search and remembered view passed.",
);
