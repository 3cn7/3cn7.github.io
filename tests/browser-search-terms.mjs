// Pill search in the library and folders, the one scrolling frame of terms with status jumps,
// new sets/folders landing in the current folder, and the time-of-day greeting.
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
await page.waitForSelector("#view h1");
const ids = await page.evaluate(async () => {
  const { Store } = await import("./assets/persistence.js"),
    { record, createStudySet, createFlashcard } = await import(
      "./assets/core.js"
    ),
    e = await import("./assets/engine.js");
  const s = await new Store().open();
  const kitchen = record("folder", { name: "Cucina italiana", parentId: null }),
    other = record("folder", { name: "Mathematics", parentId: null });
  const make = (title, folderId, n) => {
    const set = createStudySet({ title, folderId });
    return [
      set,
      ...Array.from({ length: n }, (_, i) =>
        createFlashcard(
          set.id,
          {
            term: title.slice(0, 3) + " termine " + i,
            definition: "definition " + i,
          },
          i,
        ),
      ),
    ];
  };
  const big = make("Verbi regolari", kitchen.id, 60),
    plain = make("Geometry basics", other.id, 3),
    top = make("Colori", null, 4);
  const st = (c, d, status, attempts) => ({
    ...e.blankMastery(c, d),
    status,
    attempts,
    masteredAt: status === "MASTERED" ? new Date().toISOString() : null,
  });
  const cards = big.slice(1);
  await s.putMany([
    kitchen,
    other,
    ...big,
    ...plain,
    ...top,
    st(cards[0], "forward", "MASTERED", 3),
    st(cards[1], "forward", "MASTERED", 3),
    st(cards[2], "forward", "LEARNING", 2),
    st(cards[3], "forward", "NOT_STUDIED", 5),
  ]); // started over after four misses: it was touched
  s.channel?.close();
  s.db.close();
  return { kitchen: kitchen.id, set: big[0].id };
});
// ----- search: one pill bar, nothing else to configure
await page.reload();
await page.waitForSelector(".search-pill");
for (const gone of [
  "#librarySort",
  "#subjectFilter",
  "#starSearch",
  "#nestedFolders",
  "#folderJump",
  "#libraryHint",
])
  assert.equal(await page.locator(gone).count(), 0, gone + " removed");
assert.equal(
  await page.getByRole("button", { name: "+ New set", exact: true }).count(),
  0,
  "no New set at the top level",
);
const search = page.getByRole("searchbox", { name: "Search study library" });
await search.fill("cucna"); // a typo
await page.waitForFunction(
  () => document.querySelectorAll(".folder-card").length === 1,
);
assert.match(await page.locator(".folder-card").innerText(), /Cucina italiana/);
await search.fill("verbi regolar");
await page.waitForFunction(() =>
  /Verbi regolari/.test(document.querySelector("#setGrid")?.textContent || ""),
);
await search.fill("geometri basic");
await page.waitForFunction(() =>
  /Geometry basics/.test(document.querySelector("#setGrid")?.textContent || ""),
);
await search.fill("");
// The same bar inside a folder; sets made there belong there.
await page.getByRole("link", { name: "Cucina italiana", exact: true }).click();
await page.waitForURL("**/#folder/*");
await page.waitForFunction(
  () => document.querySelector("#view h1")?.textContent === "Cucina italiana",
);
await page
  .getByRole("searchbox", { name: "Search study library" })
  .fill("regulr");
await page.waitForFunction(() =>
  /Verbi regolari/.test(document.querySelector("#setGrid")?.textContent || ""),
);
await page.getByRole("searchbox", { name: "Search study library" }).fill("");
await page.getByRole("button", { name: "+ New set", exact: true }).click();
await page.getByLabel("Title", { exact: true }).fill("Made in folder");
await page.locator("#modal button[type=submit]").click();
await page.waitForURL("**/#set/*");
await page.getByRole("button", { name: "Back to Cucina italiana" }).click();
await page.getByRole("button", { name: "+ Folder", exact: true }).click();
await page.getByLabel("Folder name", { exact: true }).fill("Nested");
await page.locator("#modal button[type=submit]").click();
await page.waitForSelector(".folder-card");
const made = await page.evaluate(async () => {
  const { Store } = await import("./assets/persistence.js");
  const s = await new Store().open(),
    parent = s.list("folder").find((f) => f.name === "Cucina italiana").id;
  const r = {
    set:
      s.list("set").find((x) => x.title === "Made in folder")?.folderId ===
      parent,
    folder:
      s.list("folder").find((f) => f.name === "Nested")?.parentId === parent,
  };
  s.channel?.close();
  s.db.close();
  return r;
});
assert.deepEqual(made, { set: true, folder: true });
// ----- one scrolling frame, no card style, no pages
await page.goto(APP + "#set/" + ids.set);
await page.waitForSelector("#termsFrame .card-row");
assert.equal(await page.locator(".pagination").count(), 0);
assert.equal(await page.locator("#cardList").count(), 0);
assert.equal(
  await page.locator("#termsFrame .card-row").count(),
  60,
  "every term is in the frame",
);
assert.equal(
  await page
    .locator(".status-group .status-list")
    .first()
    .evaluate((el) => getComputedStyle(el).overflowY),
  "visible",
);
const frame = await page.locator("#termsFrame").evaluate((el) => ({
  scrolls: el.scrollHeight > el.clientHeight,
  overflow: getComputedStyle(el).overflowY,
}));
assert.deepEqual(frame, { scrolls: true, overflow: "auto" });
const row = await page
  .locator("#termsFrame .card-row")
  .first()
  .evaluate((el) => ({
    border: getComputedStyle(el).borderRadius,
    shadow: getComputedStyle(el).boxShadow,
  }));
assert.deepEqual(
  row,
  { border: "0px", shadow: "none" },
  "flat rows, not cards",
);
// Groups: an untouched term is Not studied; a term started over after four misses is Learning.
assert.match(
  await page.locator(".status-pill.not-studied").textContent(),
  /^\s*56 Not studied/,
);
assert.match(
  await page.locator(".status-pill.learning").textContent(),
  /^\s*2 Learning/,
);
assert.match(
  await page.locator(".status-pill.mastered").textContent(),
  /^\s*2 Mastered/,
);
assert.equal(
  await page
    .locator(".status-group small.muted, .status-group > summary small")
    .count(),
  0,
  "no subtext",
);
// Each label jumps to its place in the frame.
const inView = (id) =>
  page.locator("#termsFrame").evaluate((frame, id) => {
    const f = frame.getBoundingClientRect(),
      g = document.querySelector(id).getBoundingClientRect();
    return g.top >= f.top - 2 && g.top < f.bottom - 20;
  }, id);
await page.locator(".status-pill.mastered").click();
await page.waitForFunction(
  () => document.querySelector("#termsFrame").scrollTop > 200,
);
await page.waitForTimeout(700);
assert.equal(
  await inView("#group-mastered"),
  true,
  "mastered group is brought into view",
);
await page.locator(".status-pill.not-studied").click();
await page.waitForFunction(
  () => document.querySelector("#termsFrame").scrollTop < 40,
);
await page.locator(".status-pill.learning").click();
await page.waitForTimeout(700);
assert.equal(await inView("#group-learning"), true);
// Reading rows can star and edit.
await page.locator("#termsFrame .card-star button").first().click();
await page.waitForFunction(() =>
  document.querySelector("#termsFrame .star.on"),
);
await page
  .locator("#termsFrame")
  .getByRole("button", { name: /^Edit / })
  .first()
  .click();
await page.waitForSelector("[data-card-field=term]");
// ----- greeting
await page.goto(APP + "#dashboard");
await page.waitForSelector("#greeting");
const first = await page.locator("#greeting").textContent();
assert(first.length > 3);
const set = await page.evaluate(async () => {
  const g = await import("./assets/greeting.js");
  const at = (h) => new Date(Date.UTC(2026, 9, 12, h, 0, 0));
  return {
    morning: g.greeting("Europe/Rome", at(7)).period, // 09:00 in Rome
    afternoon: g.greeting("Europe/Rome", at(13)).period, // 15:00
    evening: g.greeting("Europe/Rome", at(17)).period, // 19:00
    night: g.greeting("Europe/Rome", at(23)).period, // 01:00
    sameHour:
      g.greeting("Europe/Rome", at(7)).text ===
      g.greeting("Europe/Rome", new Date(Date.UTC(2026, 9, 12, 7, 40))).text,
    rome: g.clockIn("Europe/Rome", at(7)).hour,
    tokyo: g.clockIn("Asia/Tokyo", at(7)).hour,
    changes:
      new Set(
        Array.from(
          { length: 24 },
          (_, h) => g.greeting("Europe/Rome", at(h)).text,
        ),
      ).size > 6,
  };
});
assert.deepEqual(
  { ...set, changes: set.changes },
  {
    morning: "morning",
    afternoon: "afternoon",
    evening: "evening",
    night: "night",
    sameHour: true,
    rome: 9,
    tokyo: 16,
    changes: true,
  },
);
// The time zone is a setting.
await page.goto(APP + "#settings");
await page
  .getByLabel("Time zone (for the dashboard greeting)")
  .selectOption("Pacific/Auckland");
await page.getByRole("button", { name: "Save settings" }).click();
assert.equal(
  await page.evaluate(() => localStorage.getItem("studyPlatform.timeZone")),
  "Pacific/Auckland",
);
assert.deepEqual(errors, []);
await browser.close();
console.log(
  "Pill search, one scrolling term frame with status jumps, new items land in the folder, and the greeting passed.",
);
