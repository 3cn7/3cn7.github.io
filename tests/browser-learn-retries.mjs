// Missed questions come back on the ladder, the interface says so, and mastered terms are listed on the set page.
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
const APP = "http://127.0.0.1:8765/";
await page.goto(APP + "#library");
await page.waitForSelector("h1");
const setId = await page.evaluate(async () => {
  const { Store } = await import("./assets/persistence.js"),
    { createStudySet, createFlashcard } = await import("./assets/core.js");
  const s = await new Store().open(),
    set = createStudySet({ title: "Ladder" });
  await s.putMany([
    set,
    ...["uno", "due", "tre", "quattro", "cinque", "sei"].map((w, i) =>
      createFlashcard(set.id, { term: w, definition: "n" + w }, i),
    ),
  ]);
  s.channel?.close();
  s.db.close();
  return set.id;
});
const session = () =>
  page.evaluate(async () => {
    const { Store } = await import("./assets/persistence.js");
    const s = await new Store().open(),
      x = s.list("session").find((r) => r.mode === "learn");
    s.channel?.close();
    s.db.close();
    return x;
  });
await page.goto(APP + "#set/" + setId);
await page.getByRole("button", { name: "Learn", exact: true }).click();
await page.locator("#modal [name=roundSize]").fill("3");
await page.locator("#modal [name=shuffle]").uncheck();
await page.getByRole("button", { name: "Start studying", exact: true }).click();
const ask = async (right) => {
  await page.waitForSelector(".question-prompt");
  const q = (await session()).current;
  if (await page.locator(".choice").count()) {
    const pick = right
      ? q.correctAnswer
      : q.options.find((o) => o !== q.correctAnswer);
    await page.locator(".choice", { hasText: pick }).first().click();
  } else {
    await page.locator("#writtenAnswer").fill(right ? q.correctAnswer : "zzz");
    await page.keyboard.press("Enter");
  }
  await page.waitForSelector(".feedback");
  return q;
};
const next = async () => {
  await page.getByRole("button", { name: "Continue →", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector(".feedback"));
};
// Round 1: miss the first multiple-choice question.
const missed = await ask(false);
assert.match(
  await page.locator(".feedback").innerText(),
  /see this term again scattered among this round's typed questions/,
);
await next();
for (let i = 0; i < 2; i++) {
  await ask(true);
  await next();
}
// Typed section: the missed term appears as a "Review" question among the typed ones.
const typed = [];
for (let i = 0; i < 4; i++) {
  await page.waitForSelector(".question-prompt");
  const q = (await session()).current;
  typed.push({
    review: !!q.retry,
    card: q.cardId,
    mc: (await page.locator(".choice").count()) > 0,
  });
  if (q.retry) {
    assert.equal(await page.locator(".review-badge").count(), 1);
    assert.equal(q.cardId, missed.cardId);
    assert.equal(
      typed.at(-1).mc,
      true,
      "the first retry of a multiple-choice miss is multiple choice",
    );
  }
  await ask(true);
  await next();
}
assert.equal(typed.filter((t) => t.review).length, 1);
assert(typed.length >= 4);
// ... finish the round; mastered terms are listed on the set page.
for (
  let guard = 0;
  guard < 10 &&
  !(await page.getByRole("heading", { name: "Round complete." }).count());
  guard++
) {
  if (await page.locator(".question-prompt").count()) {
    await ask(true);
    await next();
  } else await page.waitForTimeout(100);
}
await page.getByRole("heading", { name: "Round complete." }).waitFor();
await page.goto(APP + "#set/" + setId);
await page.waitForSelector(".mastered-overview");
assert.match(
  await page.locator(".mastered-overview summary").textContent(),
  /Mastered terms \(\d+ of 6\)/,
);
assert((await page.locator(".mastered-list li").count()) >= 2);
assert.deepEqual(errors, []);
await browser.close();
console.log(
  "Missed questions climb the retry ladder with a Review label, and the set page lists mastered terms.",
);
