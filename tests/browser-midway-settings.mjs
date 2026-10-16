// Settings changed in the middle of Learn apply at once (direction in the typed section, question
// types, grading), and the mistakes in a typed answer are highlighted.
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
const eyebrow = () => page.locator(".eyebrow").first().textContent();
async function change(fn) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await fn();
  await page
    .getByRole("button", { name: "Apply and keep going", exact: true })
    .click();
  await page.waitForFunction(() =>
    /Settings applied/.test(document.querySelector("#toast")?.textContent),
  );
  await page.waitForFunction(() => !document.querySelector("#modal[open]"));
}
await page.goto(APP + "#set/" + ids.a);
await page.getByRole("button", { name: "Learn", exact: true }).click();
await page.locator("#modal [name=roundSize]").fill("3");
await page.locator("#modal [name=shuffle]").uncheck();
await page.getByRole("button", { name: "Start studying", exact: true }).click();
await page.waitForSelector(".question-panel");
for (let i = 0; i < 3; i++) {
  await answer();
  await next();
}
// ----- direction changed while the typed section of the round is under way
assert.match(await eyebrow(), /WRITTEN ANSWER · TERM → DEFINITION/);
await change(() =>
  page.getByLabel("Direction", { exact: true }).selectOption("reverse"),
);
assert.match(
  await eyebrow(),
  /WRITTEN ANSWER · DEFINITION → TERM/,
  "the question on screen switches",
);
for (let i = 0; i < 2; i++) {
  await answer();
  await next();
  assert.match(
    await eyebrow(),
    /DEFINITION → TERM/,
    "later typed questions of the round follow the new direction",
  );
}
await answer();
await next();
await page.getByRole("heading", { name: "Round complete." }).waitFor();
await page.getByRole("button", { name: "Continue learning →" }).click();
await page.waitForSelector(".question-panel");
assert.match(await eyebrow(), /DEFINITION → TERM/);
// ----- question types changed: only typed answers from now on
assert.equal((await page.locator(".choice").count()) > 0, true);
await change(async () => {
  await page.locator("#modal summary", { hasText: "Question types" }).click();
  await page.locator("#modal [name=mc]").uncheck();
});
assert.equal(
  await page.locator(".choice").count(),
  0,
  "multiple choice is gone at once",
);
assert.equal(await page.locator("#writtenAnswer").count(), 1);
for (let i = 0; i < 3; i++) {
  await answer();
  await next();
  assert.equal(await page.locator(".choice").count(), 0);
}
// ----- grading changed: the new level grades the very next answer
async function toTyped() {
  for (
    let i = 0;
    i < 12 && !(await page.locator("#writtenAnswer").count());
    i++
  ) {
    const more = page.getByRole("button", { name: "Continue learning →" });
    if (await more.count()) await more.click();
    else {
      await answer();
      await next();
    }
    await page.waitForTimeout(50);
  }
  await page.waitForSelector("#writtenAnswer");
}
const target = async () =>
  (await records())
    .filter((r) => r.type === "session" && r.mode === "learn")
    .sort((x, y) => y.startedAt.localeCompare(x.startedAt))[0].current
    .correctAnswer;
const typed = async (text) => {
  await page.locator("#writtenAnswer").fill(text);
  await page.keyboard.press("Enter");
  await page.waitForSelector(".feedback");
};
await toTyped();
await change(() =>
  page.getByLabel("Answer grading", { exact: true }).selectOption("strict"),
);
let right = await target();
await typed(
  right.toUpperCase() === right ? right.toLowerCase() : right.toUpperCase(),
);
assert.equal(
  await page.locator(".feedback.bad").count(),
  1,
  "strict: capitals matter",
);
assert.equal(
  (await page.locator(".feedback mark.diff").count()) > 0,
  true,
  "the wrong letters are highlighted",
);
const marks = await page.locator(".feedback .answer-line").first().innerText();
assert.match(marks, /Your answer:/);
await next();
await toTyped();
await change(() =>
  page.getByLabel("Answer grading", { exact: true }).selectOption("moderate"),
);
right = await target();
await typed(right.toUpperCase());
assert.equal(
  await page.locator(".feedback.good").count(),
  1,
  "moderate: capitals are ignored from the next answer on",
);
assert.equal(
  await page.locator(".feedback mark.diff").count(),
  0,
  "nothing to highlight",
);
await next();
await toTyped();
await change(() =>
  page.getByLabel("Answer grading", { exact: true }).selectOption("relaxed"),
);
right = await target();
const stripped = right.normalize("NFD").replace(/\p{M}/gu, "");
await typed(stripped);
assert.equal(
  await page.locator(".feedback.good").count(),
  1,
  "relaxed: missing accents are fine",
);
await next();
await toTyped();
right = await target();
await typed(
  right.length > 4 ? right.slice(0, 2) + right.slice(3) : right + "x",
);
const misspelled = await page.locator(".feedback.good").count();
console.log("one letter dropped:", right, misspelled ? "accepted" : "rejected");
await page.screenshot({ path: process.env.STUDY_SHOT || "/tmp/grading.png" });
assert.deepEqual(errors, []);
await browser.close();
console.log(
  "Settings changed in the middle of Learn apply at once, and typed mistakes are highlighted.",
);
