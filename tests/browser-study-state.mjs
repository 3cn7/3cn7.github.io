// Flashcards, Learn and Test keep their exact in-progress state across refreshes and
// navigation, Learn has keyboard shortcuts, and a timed test is paused (never submitted)
// while the learner is away.
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
const records = () =>
  page.evaluate(async () => {
    const { Store } = await import("./assets/persistence.js");
    const s = await new Store().open();
    const rows = s.records;
    s.channel?.close();
    s.db.close();
    return rows;
  });
const session = async (mode) =>
  (await records()).find(
    (r) => r.type === "session" && r.mode === mode && !r.deleted,
  );
const test = async () =>
  (await records()).find((r) => r.type === "test" && !r.deleted);
const startDialog = async (button, { types } = {}) => {
  await page.getByRole("button", { name: button, exact: true }).click();
  await page.locator("#modal [name=shuffle]").uncheck();
  if (types) {
    await page
      .locator("#modal .advanced-study")
      .evaluate((el) => (el.open = true));
    for (const t of ["mc", "tf", "written"])
      await page.locator(`#modal [name=${t}]`).setChecked(types.includes(t));
  }
};
await page.goto(APP + "#library");
await page.waitForSelector("h1");
const setId = await page.evaluate(async () => {
  const { Store } = await import("./assets/persistence.js"),
    { createStudySet, createFlashcard } = await import("./assets/core.js");
  const s = await new Store().open();
  const set = createStudySet({ title: "State set" });
  const words = ["ciao", "grazie", "prego", "scusi", "arrivederci"];
  await s.putMany([
    set,
    ...words.map((w, i) =>
      createFlashcard(set.id, { term: w, definition: "meaning of " + w }, i),
    ),
  ]);
  s.channel?.close();
  s.db.close();
  return set.id;
});
await page.goto(APP + "#set/" + setId);
await page.waitForSelector(".card-row");

// ---------- Flashcards ----------
await startDialog("Flashcards");
await page.getByRole("button", { name: "Start studying", exact: true }).click();
await page.waitForSelector(".study-card");
assert.equal(
  await page.locator(".study-header a").count(),
  0,
  "the back link is gone",
);
await page.getByRole("button", { name: "Next flashcard" }).click();
await page.waitForFunction(() =>
  /2 \/ 5/.test(document.querySelector(".study-controls span")?.textContent),
);
await page.getByRole("button", { name: "Next flashcard" }).click();
await page.waitForFunction(() =>
  /3 \/ 5/.test(document.querySelector(".study-controls span")?.textContent),
);
await page.keyboard.press("Space"); // flip
await page.waitForSelector(".study-card.flipped");
const flashText = await page.locator(".card-content").textContent();
await page.getByRole("button", { name: "Auto play", exact: true }).click();
await page.getByRole("button", { name: "Pause auto", exact: true }).waitFor();
await page.reload();
await page.waitForSelector(".study-card.flipped");
assert.equal(await page.locator(".card-content").textContent(), flashText);
assert.match(
  await page.locator(".study-controls span").textContent(),
  /3 \/ 5/,
);
// Automatic playback does not restart behind the learner's back, but is offered again.
await page
  .getByRole("button", { name: "Resume auto play", exact: true })
  .waitFor();
// Navigating away pauses the study clock; it keeps the state exactly.
let flash = await session("flashcards");
assert.equal(flash.index, 2);
assert.equal(flash.flipped, true);
await page.goto(APP + "#library");
await page.waitForSelector("#setGrid");
await page.waitForTimeout(300);
const away1 = (await session("flashcards")).activeMs;
await page.waitForTimeout(2000);
const away2 = (await session("flashcards")).activeMs;
assert.equal(away1, away2, "time away is not counted as study time");
assert(away1 > 0);
await page.goto(APP + "#dashboard");
await page.getByText("Flashcards · card 3 of 5").waitFor();
await page.getByRole("button", { name: "Resume", exact: true }).click();
await page.waitForSelector(".study-card.flipped");
assert.equal(await page.locator(".card-content").textContent(), flashText);
await page.getByRole("button", { name: "Save & exit", exact: true }).click();
await page.waitForURL("**/#library");

// A new session for the same set offers the unfinished one first.
await page.goto(APP + "#set/" + setId);
await page.getByRole("button", { name: "Flashcards", exact: true }).click();
await page.getByText("You have an unfinished Flashcards session").waitFor();
await page
  .getByRole("button", { name: "Resume where I left off", exact: true })
  .click();
await page.waitForSelector(".study-card.flipped");
assert.equal(await page.locator("#modal[open]").count(), 0);
await page.getByRole("button", { name: "Finish review", exact: true }).click();
await page.getByRole("button", { name: "Finish session", exact: true }).click();
await page.waitForURL("**/#library");

// ---------- Learn ----------
await page.goto(APP + "#set/" + setId);
await startDialog("Learn", { types: ["written"] });
await page.getByRole("button", { name: "Start studying", exact: true }).click();
await page.waitForSelector("#writtenAnswer");
assert.equal(
  await page.evaluate(() => document.activeElement?.id),
  "writtenAnswer",
  "the answer box is focused",
);
assert.match(
  await page.locator(".shortcut-hint").innerText(),
  /Enter to submit/,
);
// Enter is not intercepted before an answer is graded.
await page.locator("h1").click();
await page.keyboard.press("Enter");
await page.waitForTimeout(250);
assert.equal(await page.locator(".feedback").count(), 0);
// A half-typed answer and a hint survive a refresh.
await page.locator("#writtenAnswer").fill("half typ");
await page.keyboard.press("Alt+KeyH");
await page.waitForFunction(() =>
  document.querySelector("#hintText")?.textContent.startsWith("Hint:"),
);
await page.waitForTimeout(700);
await page.reload();
await page.waitForSelector("#writtenAnswer");
assert.equal(await page.locator("#writtenAnswer").inputValue(), "half typ");
assert.match(await page.locator("#hintText").textContent(), /^Hint:/);
const prompt1 = await page.locator(".question-prompt").textContent();
const answerOf = async () => (await session("learn")).current.correctAnswer;
// A correct answer is graded with Enter; the same key press does not also advance.
await page.locator("#writtenAnswer").fill(await answerOf());
await page.keyboard.press("Enter");
await page.waitForSelector(".feedback.good");
await page.waitForTimeout(400);
assert.equal(
  await page.locator(".feedback.good").count(),
  1,
  "one Enter submits only",
);
assert.equal(
  await page.evaluate(() => document.activeElement?.dataset?.action),
  "learn-continue",
  "focus moves to Continue after grading",
);
assert.match(await page.locator(".feedback").innerText(), /press Enter/);
// A refresh while the feedback is showing restores it exactly.
await page.reload();
await page.waitForSelector(".feedback.good");
await page.locator("h1").click(); // focus leaves every control
await page.keyboard.press("Enter");
await page.waitForFunction(
  () =>
    !document.querySelector(".feedback") &&
    document.querySelector("#writtenAnswer:not([disabled])"),
);
assert.notEqual(await page.locator(".question-prompt").textContent(), prompt1);
// A wrong answer needs a deliberate Continue; Enter inside the box only submits.
await page.locator("#writtenAnswer").fill("definitely wrong");
await page.keyboard.press("Enter");
await page.waitForSelector(".feedback.bad");
await page.waitForTimeout(500);
await page.keyboard.press("Enter"); // focus is on Continue: native activation
await page.waitForFunction(() => !document.querySelector(".feedback"));
// Shortcut help is reachable by keyboard and by button.
await page.locator("h1").click();
await page.keyboard.press("?");
await page.getByRole("heading", { name: "Keyboard shortcuts" }).waitFor();
assert.match(await page.locator("#modal").innerText(), /Enter[\s\S]*continue/);
await page.keyboard.press("Escape");
await page.getByRole("button", { name: "Save & exit", exact: true }).click();
await page.waitForURL("**/#library");
// Multiple choice: number keys answer, Enter continues.
await page.goto(APP + "#set/" + setId);
await startDialog("Learn", { types: ["mc"] });
await page.getByRole("button", { name: "Start studying", exact: true }).click();
await page.waitForSelector(".choice");
assert.match(
  await page.locator(".shortcut-hint").innerText(),
  /Press 1–4 to answer/,
);
await page.locator("h1").click();
await page.keyboard.press("Enter");
await page.waitForTimeout(200);
assert.equal(
  await page.locator(".feedback").count(),
  0,
  "Enter does not answer a choice question",
);
const choiceIndex = await page.evaluate(async () => {
  const { Store } = await import("./assets/persistence.js");
  const s = await new Store().open(),
    q = s
      .list("session")
      .filter((x) => x.mode === "learn" && !x.finishedAt)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0].current;
  s.channel?.close();
  s.db.close();
  return q.options.indexOf(q.correctAnswer) + 1;
});
await page.keyboard.press(String(choiceIndex));
await page.waitForSelector(".feedback.good");
await page.locator("h1").click();
await page.keyboard.press("Enter");
await page.waitForFunction(
  () =>
    !document.querySelector(".feedback") &&
    document.querySelector(".choice:not([disabled])"),
);
await page.getByRole("button", { name: "Save & exit", exact: true }).click();

// ---------- Test ----------
await page.goto(APP + "#set/" + setId);
await startDialog("Test", { types: ["written"] });
await page.locator("[name=timerMinutes]").fill("30");
await page.getByRole("button", { name: "Start test", exact: true }).click();
await page.waitForSelector("#testTimer");
await page.locator("#writtenAnswer").fill("first answer");
await page
  .getByRole("button", { name: "Mark for review", exact: true })
  .click();
await page.getByRole("button", { name: "Next →", exact: true }).click();
await page.locator("#writtenAnswer").fill("second answer");
await page.getByRole("button", { name: "Next →", exact: true }).click();
await page.waitForTimeout(600);
await page.reload();
await page.waitForSelector("#testTimer");
assert.match(
  await page.locator(".row.between .muted").first().innerText(),
  /Question 3 \/ 5 · 2 answered/,
);
await page.getByRole("button", { name: "← Previous", exact: true }).click();
await page.waitForFunction(
  () => document.querySelector("#writtenAnswer")?.value === "second answer",
);
await page.getByRole("button", { name: "← Previous", exact: true }).click();
await page.waitForFunction(
  () => document.querySelector("#writtenAnswer")?.value === "first answer",
);
assert.equal(
  await page.getByRole("button", { name: "Unmark review" }).count(),
  1,
);
// The countdown stops while the learner is elsewhere.
await page.goto(APP + "#dashboard");
await page.waitForSelector("h1");
await page.waitForTimeout(300);
const paused = await test();
assert(!paused.submittedAt && paused.timerPaused === true);
assert(paused.remainingMs > 29 * 60000 && paused.remainingMs <= 30 * 60000);
await page.waitForTimeout(2500);
assert.equal(
  (await test()).remainingMs,
  paused.remainingMs,
  "no time is lost while away",
);
await page.getByText(/Test · question 1 of 5 · 2 answered · 29m/).waitFor();
await page.getByRole("button", { name: "Resume test", exact: true }).click();
await page.waitForSelector("#testTimer");
assert.match(
  await page.locator("#testTimer").textContent(),
  /^29m \d+s remaining$/,
);
// Running out of time while the test is on screen submits it with a visible explanation.
await page.evaluate(async () => {
  const { Store } = await import("./assets/persistence.js");
  const s = await new Store().open(),
    t = s.list("test")[0];
  await s.update(t.id, (r) => ({ ...r, remainingMs: 2200, timerPaused: true }));
  s.channel?.close();
  s.db.close();
});
await page.reload();
await page.waitForSelector(".score", { timeout: 15000 });
assert.match(await page.locator("#toast").textContent(), /Time expired/);
assert.match(
  await page.locator(".study-layout").innerText(),
  /submitted automatically/,
);
const done = await test();
assert.equal(done.submittedBy, "timer");
assert.equal(done.answers[done.questions[0].id], "first answer");
assert.deepEqual(errors, []);
await browser.close();
console.log(
  "Flashcards, Learn and Test resume exactly after refresh and navigation; Enter, number keys and ? shortcuts work; a timed test pauses while away.",
);
