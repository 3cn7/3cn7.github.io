// Learn rounds (multiple choice first, then typed), changing direction mid-session, Italian letter
// buttons, only the latest progress on the dashboard, and the version serial.
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
const records = () =>
  page.evaluate(async () => {
    const { Store } = await import("./assets/persistence.js");
    const s = await new Store().open(),
      rows = s.records;
    s.channel?.close();
    s.db.close();
    return rows;
  });
await page.goto(APP + "#library");
await page.waitForSelector("h1");
const ids = await page.evaluate(async () => {
  const { Store } = await import("./assets/persistence.js"),
    { createStudySet, createFlashcard } = await import("./assets/core.js");
  const s = await new Store().open();
  const make = (title, words) => {
    const set = createStudySet({
      title,
      termLanguage: "it",
      definitionLanguage: "en",
    });
    return [
      set,
      ...words.map(([t, d], i) =>
        createFlashcard(set.id, { term: t, definition: d }, i),
      ),
    ];
  };
  const a = make("Parole", [
    ["città", "city"],
    ["perché", "why"],
    ["è", "is"],
    ["più", "more"],
    ["caffè", "coffee"],
    ["università", "university"],
  ]);
  const b = make("Other", [
    ["uno", "one"],
    ["due", "two"],
  ]);
  await s.putMany([...a, ...b]);
  s.channel?.close();
  s.db.close();
  return { a: a[0].id, b: b[0].id };
});
const answer = async (right = true) => {
  const q = (await records())
    .filter((r) => r.type === "session" && r.mode === "learn")
    .sort((x, y) => y.startedAt.localeCompare(x.startedAt))[0].current;
  if (await page.locator(".choice").count())
    await page.locator(".choice", { hasText: q.correctAnswer }).first().click();
  else {
    await page.locator("#writtenAnswer").fill(right ? q.correctAnswer : "zzz");
    await page.keyboard.press("Enter");
  }
  await page.waitForSelector(".feedback");
};
const next = async () => {
  await page.getByRole("button", { name: "Continue →", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector(".feedback"));
};
// ----- rounds: 3 multiple-choice questions, then the same terms typed
await page.goto(APP + "#set/" + ids.a);
await page.getByRole("button", { name: "Learn", exact: true }).click();
await page.locator("#modal [name=roundSize]").fill("3");
await page.locator("#modal [name=shuffle]").uncheck();
await page.getByRole("button", { name: "Start studying", exact: true }).click();
await page.waitForSelector(".question-panel");
const kinds = [],
  prompts = [];
for (let i = 0; i < 6; i++) {
  await page.waitForSelector(".question-prompt");
  kinds.push((await page.locator(".choice").count()) ? "mc" : "typed");
  prompts.push(await page.locator(".question-prompt").textContent());
  if (i === 0)
    assert.match(
      await page
        .locator(".badge", { hasText: "Multiple choice" })
        .textContent(),
      /Multiple choice · 1 of 3/,
    );
  if (i === 3)
    assert.match(
      await page.locator(".badge", { hasText: "Typing" }).textContent(),
      /Typing · 1 of 3/,
    );
  await answer();
  if (i < 5) await next();
}
assert.deepEqual(kinds, ["mc", "mc", "mc", "typed", "typed", "typed"]);
assert.deepEqual(
  prompts.slice(3),
  prompts.slice(0, 3),
  "the typed questions repeat the round's terms",
);
await next();
await page.getByRole("heading", { name: "Round complete." }).waitFor();
await page.getByRole("button", { name: "Continue learning →" }).click();
await page.waitForSelector(".choice");
// ----- change direction in the middle: progress is kept
const before = (await records()).find(
  (r) => r.type === "session" && r.mode === "learn",
);
await page.getByRole("button", { name: "Settings", exact: true }).click();
assert.equal(
  await page.locator("#modal [name=filter]").count(),
  0,
  "pool and goal are not re-asked",
);
await page.getByLabel("Direction", { exact: true }).selectOption("reverse");
await page
  .getByRole("button", { name: "Apply and keep going", exact: true })
  .click();
await page.waitForFunction(() =>
  /Settings applied/.test(document.querySelector("#toast")?.textContent),
);
const after = (await records()).find((r) => r.id === before.id);
assert.equal(after.id, before.id);
assert.equal(after.attempts.length, before.attempts.length);
assert.equal(after.config.direction, "reverse");
assert.equal(after.round, before.round);
assert.equal(after.current.direction, "reverse");
assert.equal(
  (await records()).filter((r) => r.type === "session" && r.mode === "learn")
    .length,
  1,
  "no new session",
);
const forwardStates = Object.keys(after.states).filter(
  (k) => k.endsWith(":forward") && after.states[k].attempts > 0,
);
assert(forwardStates.length >= 3, "earlier mastery is kept");
// ----- Italian letter buttons: the answer is now an Italian term
for (let i = 0; i < 5; i++)
  if (!(await page.locator("#writtenAnswer").count())) {
    await answer();
    await next();
  }
await page.waitForSelector("#writtenAnswer");
await page.waitForSelector(".accent-bar");
await page.locator("#writtenAnswer").fill("citt");
await page.getByRole("button", { name: "Insert à", exact: true }).click();
assert.equal(await page.locator("#writtenAnswer").inputValue(), "città");
await page.getByRole("button", { name: "Capital letters" }).click();
await page.getByRole("button", { name: "Insert È", exact: true }).click();
assert.equal(await page.locator("#writtenAnswer").inputValue(), "cittàÈ");
assert.equal(
  await page.evaluate(() => document.activeElement.id),
  "writtenAnswer",
  "focus stays in the answer box",
);
await page.getByRole("button", { name: "Save & exit", exact: true }).click();
await page.waitForURL("**/#library");
// ----- no letter buttons when the answer is English
await page.goto(APP + "#set/" + ids.b);
await page.getByRole("button", { name: "Learn", exact: true }).click();
await page.getByRole("button", { name: "Start studying", exact: true }).click();
await page.waitForSelector(".question-prompt");
assert.equal(await page.locator(".accent-bar").count(), 0);
await page.getByRole("button", { name: "Save & exit", exact: true }).click();
await page.waitForURL("**/#library");
// ----- the dashboard shows only the most recent progress
await page.goto(APP + "#dashboard");
await page.waitForSelector(".streak-days");
assert.equal(await page.locator(".resume-row").count(), 1);
assert.match(await page.locator(".resume-row").innerText(), /Other/);
// ----- version serial
assert.match(
  (await page.locator("#appVersion").textContent()).trim(),
  /^Version v\d+\.\d+\.\d+ · build [0-9a-f]{8}$/,
);
assert.deepEqual(errors, []);
await browser.close();
console.log(
  "Rounds go multiple choice then typing, direction changes keep progress, Italian letters, latest-only resume and version serial passed.",
);
