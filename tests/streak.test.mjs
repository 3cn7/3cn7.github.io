import test from "node:test";
import assert from "node:assert/strict";
import {
  dayKey,
  studyDays,
  studyStreak,
  streakWeeks,
  streakLength,
} from "../assets/streak.js";
// Local-time constructors keep the expectations independent of the machine's time zone.
const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min);
const attempt = (when) => ({ type: "attempt", at: when.toISOString() });
const daysRecord = (...days) => ({ type: "session", mode: "flashcards", days });
const now = at(2026, 10, 11, 9);

test("no study records means no streak", () => {
  const s = studyStreak([], now);
  assert.equal(s.days, 0);
  assert.equal(s.best, 0);
  assert.equal(s.studiedToday, false);
  assert.equal(s.atRisk, false);
  assert.equal(s.last.length, 7);
  assert.equal(s.last.at(-1).today, true);
});

test("consecutive days ending today are counted once per calendar day", () => {
  const records = [
    attempt(at(2026, 10, 11, 8)),
    attempt(at(2026, 10, 11, 20)), // two answers on one day still count as one day
    attempt(at(2026, 10, 10, 23, 59)),
    attempt(at(2026, 10, 9, 0, 1)),
  ];
  const s = studyStreak(records, now);
  assert.equal(s.days, 3);
  assert.equal(s.studiedToday, true);
  assert.equal(s.atRisk, false);
});

test("the streak survives until the end of tomorrow, then breaks", () => {
  const records = [attempt(at(2026, 10, 10)), attempt(at(2026, 10, 9))];
  const waiting = studyStreak(records, now);
  assert.equal(waiting.days, 2);
  assert.equal(waiting.studiedToday, false);
  assert.equal(waiting.atRisk, true);
  assert.equal(studyStreak(records, at(2026, 10, 12, 8)).days, 0);
});

test("a missed day resets the count but keeps the best streak", () => {
  const records = [
    ...[5, 6, 7, 8].map((d) => attempt(at(2026, 10, d))),
    attempt(at(2026, 10, 11)),
  ];
  const s = studyStreak(records, now);
  assert.equal(s.days, 1);
  assert.equal(s.best, 4);
});

test("daylight-saving changes do not break or extend a streak", () => {
  // US clocks changed on March 8 and November 1, 2026; keys are plain calendar days.
  const spring = studyStreak(
    [daysRecord("2026-03-07", "2026-03-08", "2026-03-09")],
    at(2026, 3, 9, 10),
  );
  assert.equal(spring.days, 3);
  const autumn = studyStreak(
    [daysRecord("2026-10-31", "2026-11-01", "2026-11-02")],
    at(2026, 11, 2, 23, 30),
  );
  assert.equal(autumn.days, 3);
  assert.equal(dayKey(at(2026, 11, 1, 0, 30)), "2026-11-01");
});

test("sessions count only when the learner interacted, and legacy sessions use their end days", () => {
  const opened = {
    type: "session",
    mode: "flashcards",
    reviewed: [],
    assessments: {},
    startedAt: at(2026, 10, 11).toISOString(),
    updatedAt: at(2026, 10, 11).toISOString(),
  };
  assert.equal(studyStreak([opened], now).days, 0);
  const legacy = {
    ...opened,
    reviewed: ["card"],
    startedAt: at(2026, 10, 10).toISOString(),
    updatedAt: at(2026, 10, 11).toISOString(),
  };
  assert.equal(studyStreak([legacy], now).days, 2);
});

test("submitted tests count by submission day; erased and future records do not", () => {
  const records = [
    { type: "test", answers: {}, submittedAt: at(2026, 10, 11).toISOString() },
    { type: "attempt", erased: true, at: at(2026, 10, 10).toISOString() },
    attempt(at(2026, 10, 14)), // device clock moved back: ignore days after today
  ];
  const s = studyStreak(records, now);
  assert.equal(s.days, 1);
  assert.deepEqual([...studyDays(records)].sort(), [
    "2026-10-11",
    "2026-10-14",
  ]);
});

test("the last-seven-days strip marks exactly the studied days", () => {
  const s = studyStreak(
    [
      attempt(at(2026, 10, 11)),
      attempt(at(2026, 10, 9)),
      attempt(at(2026, 10, 5)),
    ],
    now,
  );
  assert.deepEqual(
    s.last.map((d) => [d.key, d.studied]),
    [
      ["2026-10-05", true],
      ["2026-10-06", false],
      ["2026-10-07", false],
      ["2026-10-08", false],
      ["2026-10-09", true],
      ["2026-10-10", false],
      ["2026-10-11", true],
    ],
  );
});

test("long streaks are also described in weeks", () => {
  assert.equal(streakLength(1), "1 day");
  assert.equal(streakLength(6), "6 days");
  assert.equal(streakWeeks(6), "");
  assert.equal(streakWeeks(7), "1 week");
  assert.equal(streakWeeks(17), "2 weeks, 3 days");
  assert.equal(streakWeeks(15), "2 weeks, 1 day");
  const days = Array.from({ length: 17 }, (_, i) =>
    dayKey(at(2026, 9, 25 + i)),
  );
  const s = studyStreak([daysRecord(...days)], now);
  assert.equal(s.days, 17);
  assert.equal(s.weeks, 2);
  assert.equal(s.extraDays, 3);
});
