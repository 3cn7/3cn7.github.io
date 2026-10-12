// Logo and sidebar, dashboard streak, Undo scope, back button and per-set Learn reset.
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
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const APP = "http://127.0.0.1:8765/";
const records = (target = page) =>
  target.evaluate(async () => {
    const { Store } = await import("./assets/persistence.js");
    const s = await new Store().open();
    const rows = s.records;
    s.channel?.close();
    s.db.close();
    return rows;
  });
await page.goto(APP + "#dashboard");
await page.waitForSelector("h1");

// ---------- logo and sidebar ----------
const offsets = () =>
  page.evaluate(() => {
    const frame = document.querySelector(".brand-mark").getBoundingClientRect(),
      glyph = document
        .querySelector(".brand-mark path")
        .getBoundingClientRect();
    return {
      dx: glyph.left + glyph.width / 2 - (frame.left + frame.width / 2),
      dy: glyph.top + glyph.height / 2 - (frame.top + frame.height / 2),
      ratio: glyph.width / frame.width,
      square: Math.abs(frame.width - frame.height) < 0.5,
    };
  });
for (const [width, theme] of [
  [1280, "light"],
  [1280, "dark"],
  [390, "light"],
]) {
  await page.setViewportSize({ width, height: 900 });
  await page.evaluate(
    (t) => (document.documentElement.dataset.theme = t),
    theme,
  );
  const o = await offsets();
  assert(
    Math.abs(o.dx) <= 0.6 && Math.abs(o.dy) <= 0.6,
    `S is centred (${width}, ${theme}): ${JSON.stringify(o)}`,
  );
  assert(o.square && o.ratio > 0.4 && o.ratio < 0.8);
}
await page.setViewportSize({ width: 1280, height: 900 });
await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
const gap = await page.evaluate(() => {
  const status = document
      .querySelector(".sidebar-status")
      .getBoundingClientRect(),
    link = document.querySelector(".sidebar-link").getBoundingClientRect();
  return { gap: link.top - status.bottom, sameLine: link.top < status.bottom };
});
assert(
  !gap.sameLine && gap.gap >= 12,
  "saved status and Drive link are separated: " + JSON.stringify(gap),
);
assert.equal(
  await page.locator('[data-action="undo"]').count(),
  0,
  "no global Undo in the header",
);
assert.equal(
  await page.getByRole("button", { name: "+ Create", exact: true }).count(),
  1,
);

// ---------- dashboard ----------
assert.equal(
  await page.getByRole("button", { name: "+ New study set" }).count(),
  0,
);
assert.equal(
  await page.locator(".hero a.button, .hero .row a").count(),
  0,
  "hero buttons are replaced",
);
assert.equal(
  await page.locator(".hero-art .art-card").count(),
  1,
  "card illustration is kept",
);
assert.equal(await page.locator(".streak-days").textContent(), "0");
assert.match(
  await page.locator(".streak-status").textContent(),
  /to start a streak/,
);
const seed = (days) =>
  page.evaluate(async (days) => {
    const { Store } = await import("./assets/persistence.js"),
      { record } = await import("./assets/core.js");
    const s = await new Store().open();
    const rows = days.map((ago) => {
      const at = new Date();
      at.setDate(at.getDate() - ago);
      at.setHours(12, 0, 0, 0);
      return record("attempt", {
        sessionId: "seed",
        cardId: "c",
        setId: "s",
        direction: "forward",
        questionType: "written",
        response: "x",
        effectiveCorrect: true,
        at: at.toISOString(),
      });
    });
    await s.putMany(rows);
    s.channel?.close();
    s.db.close();
  }, days);
await seed([0, 1, 2, 4]); // today, yesterday, two days ago, then a gap
await page.reload();
await page.waitForSelector(".streak-days");
assert.equal(await page.locator(".streak-days").textContent(), "3");
assert.equal(
  await page.locator("#streakValue").getAttribute("aria-label"),
  "Study streak: 3 days",
);
assert.match(
  await page.locator(".streak-status").textContent(),
  /You studied today/,
);
assert.equal(await page.locator(".streak-week li.studied").count(), 4);
assert.equal(await page.locator(".streak-week li.today.studied").count(), 1);
assert.equal(await page.locator(".streak-weeks").count(), 0);
await seed([3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
await page.reload();
await page.waitForSelector(".streak-days");
assert.equal(await page.locator(".streak-days").textContent(), "15");
assert.equal(
  await page.locator(".streak-weeks").textContent(),
  "2 weeks, 1 day",
);
await page.locator(".streak-help summary").click();
assert.match(
  await page.locator(".streak-help p").innerText(),
  /local calendar day/,
);
// ---------- a fresh profile: opening a session is not studying; answering is ----------
const fresh = await browser.newPage({ viewport: { width: 1280, height: 900 } });
fresh.on("pageerror", (e) => errors.push(e.message));
await fresh.goto(APP + "#library");
await fresh.waitForSelector("h1");
const setId = await fresh.evaluate(async () => {
  const { Store } = await import("./assets/persistence.js"),
    { createStudySet, createFlashcard } = await import("./assets/core.js");
  const s = await new Store().open();
  const set = createStudySet({ title: "Reset target" }),
    other = createStudySet({ title: "Untouched" });
  await s.putMany([
    set,
    other,
    ...["uno", "due", "tre"].map((w, i) =>
      createFlashcard(set.id, { term: w, definition: "n" + w }, i),
    ),
    ...["quattro", "cinque"].map((w, i) =>
      createFlashcard(other.id, { term: w, definition: "n" + w }, i),
    ),
  ]);
  s.channel?.close();
  s.db.close();
  return set.id;
});
await fresh.goto(APP + "#set/" + setId);
await fresh.waitForSelector(".card-row");
await fresh.getByRole("button", { name: "Flashcards", exact: true }).click();
await fresh
  .getByRole("button", { name: "Start studying", exact: true })
  .click();
await fresh.waitForSelector(".study-card");
await fresh.getByRole("button", { name: "Save & exit", exact: true }).click();
await fresh.waitForURL("**/#library");
await fresh.goto(APP + "#dashboard");
await fresh.waitForSelector(".streak-days");
assert.equal(
  await fresh.locator(".streak-days").textContent(),
  "0",
  "an untouched session does not count",
);
await fresh.goto(APP + "#set/" + setId);
await fresh.getByRole("button", { name: "Learn", exact: true }).click();
await fresh
  .getByRole("button", { name: "Start studying", exact: true })
  .click();
await fresh.waitForSelector(".question-prompt");
await fresh.getByRole("button", { name: "Don't know", exact: true }).click();
await fresh.waitForSelector(".feedback");
await fresh.goto(APP + "#dashboard");
await fresh.waitForSelector(".streak-days");
assert.equal(await fresh.locator(".streak-days").textContent(), "1");
assert.match(
  await fresh.locator(".streak-status").textContent(),
  /You studied today/,
);
assert.equal(
  await fresh
    .locator("#streakValue")
    .textContent()
    .then((t) => t.trim()),
  "1 day",
);
// Pretend the only study day was yesterday: the streak is alive but needs today.
await fresh.evaluate(async () => {
  const { Store } = await import("./assets/persistence.js"),
    { dayKey } = await import("./assets/streak.js");
  const s = await new Store().open(),
    before = new Date(Date.now() - 86400000),
    yesterday = before.toISOString();
  await s.change(
    "age",
    (rows) =>
      rows.map((r) =>
        r.type === "attempt"
          ? { ...r, at: yesterday }
          : r.type === "session"
            ? { ...r, days: [dayKey(before)] }
            : r,
      ),
    { undo: false },
  );
  s.channel?.close();
  s.db.close();
});
await fresh.reload();
await fresh.waitForSelector(".streak-days");
assert.match(
  await fresh.locator(".streak-status").textContent(),
  /Study today to keep your 1 day going/,
);
assert.equal(await fresh.locator(".streak-week li.today.studied").count(), 0);

// ---------- Undo lives in the card editor only ----------
await fresh.goto(APP + "#set/" + setId);
await fresh.waitForSelector(".card-row");
assert.equal(
  await fresh.getByRole("button", { name: /Undo/ }).count(),
  0,
  "no Undo outside editing",
);
await fresh.getByRole("button", { name: "Edit cards", exact: true }).click();
const undo = fresh.getByRole("button", { name: /Undo last card change/ });
assert(await undo.isDisabled(), "disabled until there is a card change");
await fresh.getByRole("button", { name: "+ Add card", exact: true }).click();
await fresh.waitForFunction(
  () => document.querySelectorAll(".card-row").length === 4,
);
assert(await undo.isEnabled());
assert.match(await undo.getAttribute("aria-label"), /Edit card/);
await undo.click();
await fresh.waitForFunction(
  () => document.querySelectorAll(".card-row").length === 3,
);
assert.match(await fresh.locator("#toast").textContent(), /Undid: Edit card/);
// Text edits can be undone too.
await fresh.locator('[data-card-field="term"]').first().fill("changed");
await fresh.waitForTimeout(500);
await fresh.getByRole("button", { name: /Undo last card change/ }).click();
await fresh.waitForFunction(
  () => document.querySelector('[data-card-field="term"]')?.value === "uno",
);
// A change outside the card flow takes Undo away again.
await fresh.getByRole("button", { name: "Done editing", exact: true }).click();
await fresh.goto(APP + "#library");
assert.equal(
  await fresh.getByRole("button", { name: /Undo/ }).count(),
  0,
  "no Undo in the library",
);

// ---------- Reset Learn progress for one set ----------
const ids = await fresh.evaluate(async (setId) => {
  const { Store } = await import("./assets/persistence.js"),
    e = await import("./assets/engine.js");
  const s = await new Store().open();
  const cardsOf = (id) => s.list("card").filter((c) => c.setId === id);
  const sets = s.list("set"),
    other = sets.find((x) => x.id !== setId);
  const mastered = (c) => ({
    ...e.blankMastery(c, "forward"),
    status: "MASTERED",
    consecutiveCorrect: 3,
    streakRecall: 2,
    attempts: 3,
    correct: 3,
    masteredAt: new Date().toISOString(),
  });
  const all = [...cardsOf(setId), ...cardsOf(other.id)];
  const learning = all.map(mastered);
  const session = e.createLearnSession(all, learning, { ...e.DEFAULT_STUDY });
  const fresh = new Set([...learning, session].map((r) => r.id));
  await s.change(
    "seed mastery",
    (rows) => [...rows.filter((r) => !fresh.has(r.id)), ...learning, session],
    { undo: false },
  );
  const attempts = s.list("attempt").length;
  s.channel?.close();
  s.db.close();
  return { setId, other: other.id, attempts, session: session.id };
}, setId);
await fresh.goto(APP + "#set/" + setId);
await fresh.waitForSelector(".card-row");
assert.match(await fresh.locator(".study-metrics").innerText(), /3 mastered/);
await fresh
  .locator(".context-menu summary", { hasText: "More set actions" })
  .click();
await fresh
  .getByRole("button", { name: "Reset Learn progress", exact: true })
  .click();
assert.match(
  await fresh.locator("#modal").innerText(),
  /Reset Learn progress for “Reset target”\?/,
);
assert.match(
  await fresh.locator("#modal").innerText(),
  /Other sets, the cards, stars, answer history/,
);
await fresh
  .getByRole("button", { name: "Reset this set’s progress", exact: true })
  .click();
await fresh.waitForFunction(() =>
  /0 mastered/.test(document.querySelector(".study-metrics")?.textContent),
);
const after = await records(fresh);
const statusOf = (id) =>
  after
    .filter((r) => r.type === "learning" && r.setId === id)
    .map((r) => r.status);
assert.deepEqual([...new Set(statusOf(ids.setId))], ["NOT_STUDIED"]);
assert.deepEqual(
  [...new Set(statusOf(ids.other))],
  ["MASTERED"],
  "other sets keep their progress",
);
assert.equal(
  after.filter((r) => r.type === "attempt").length,
  ids.attempts,
  "answer history is untouched",
);
assert.equal(after.filter((r) => r.type === "card" && !r.deleted).length, 5);
const unfinished = after.find((r) => r.id === ids.session);
const inSet = Object.values(unfinished.states).filter(
    (x) => x.setId === ids.setId,
  ),
  inOther = Object.values(unfinished.states).filter(
    (x) => x.setId === ids.other,
  );
assert(inSet.every((x) => x.status === "NOT_STUDIED" && !x.masteredAt));
assert(inOther.every((x) => x.status === "MASTERED"));
assert.match(
  await fresh.locator("#toast").textContent(),
  /Learn progress reset for “Reset target”/,
);
// Resuming that session continues from the reset state rather than writing old progress back.
await fresh.goto(APP + "#study/" + ids.session);
await fresh.waitForSelector(".question-prompt");
assert.match(
  await fresh.locator(".study-metrics").innerText(),
  /2\/5 mastered/,
);
assert.deepEqual(errors, []);
await browser.close();
console.log(
  "Centred logo, sidebar spacing, dashboard streak, scoped Undo, no back link and per-set Learn reset passed.",
);
