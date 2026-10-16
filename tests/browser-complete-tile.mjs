// A set whose terms are all mastered shows it on its card, whichever direction was studied.
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
const ids = await page.evaluate(async () => {
  const { Store } = await import("./assets/persistence.js"),
    { createStudySet, createFlashcard } = await import("./assets/core.js"),
    { blankMastery } = await import("./assets/engine.js");
  const s = await new Store().open();
  const make = (title, words, directions) => {
    const set = createStudySet({ title });
    const cards = words.map(([term, definition], i) =>
      createFlashcard(set.id, { term, definition }, i),
    );
    const states = cards.flatMap((c) =>
      directions.map((d) => ({
        ...blankMastery(c, d),
        status: "MASTERED",
        attempts: 4,
        correct: 4,
        masteredAt: new Date().toISOString(),
      })),
    );
    return { set, all: [set, ...cards, ...states] };
  };
  const words = [
    ["uno", "one"],
    ["due", "two"],
  ];
  const reverse = make("Reverse only", words, ["reverse"]),
    both = make("Both directions", words, ["forward", "reverse"]),
    half = make("Half done", words, ["forward"]);
  half.all.pop();
  await s.putMany([...reverse.all, ...both.all, ...half.all]);
  s.channel?.close();
  s.db.close();
  return { reverse: reverse.set.id, both: both.set.id, half: half.set.id };
});
await page.goto(APP + "#library");
await page.waitForSelector(".set-tile");
const tile = (id) => page.locator(`.set-tile[data-set-id="${id}"]`);
for (const id of [ids.reverse, ids.both]) {
  assert.match(await tile(id).innerText(), /All terms mastered/);
  assert.equal(
    await tile(id)
      .getAttribute("aria-label")
      .catch(() => null),
    null,
  );
  assert.equal(
    await tile(id).locator(".progress").getAttribute("aria-valuenow"),
    "100",
  );
  assert.equal(
    await tile(id).evaluate((t) => t.classList.contains("is-complete")),
    true,
  );
}
assert.match(await tile(ids.half).innerText(), /1 mastered/);
assert.equal(
  await tile(ids.half).locator(".progress").getAttribute("aria-valuenow"),
  "50",
);
assert.equal(
  await tile(ids.half).evaluate((t) => t.classList.contains("is-complete")),
  false,
);
// the dashboard and the set page agree
await page.goto(APP + "#set/" + ids.reverse);
await page.waitForSelector("#termsFrame");
assert.match(
  await page.locator(".status-pill.mastered").innerText(),
  /2\s+Mastered/,
);
assert.match(
  await page.locator(".study-metrics").first().innerText(),
  /2 mastered/,
);
await page.goto(APP + "#dashboard");
await page.waitForSelector(".metrics");
assert.match(await page.locator(".metrics").innerText(), /Mastered terms\s*5/);
assert.deepEqual(errors, []);
await browser.close();
console.log("Fully mastered sets show it on their cards in either direction.");
