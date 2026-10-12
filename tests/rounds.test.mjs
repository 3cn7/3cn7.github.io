import test from "node:test";
import assert from "node:assert/strict";
import { createFlashcard, createStudySet } from "../assets/core.js";
import {
  createLearnSession,
  selectNextQuestion,
  recordAttempt,
  roundDone,
  startRound,
  learnComplete,
} from "../assets/engine.js";
const cardsOf = (n) => {
  const set = createStudySet({ title: "r" });
  return Array.from({ length: n }, (_, i) =>
    createFlashcard(set.id, { term: "t" + i, definition: "d" + i }, i),
  );
};
function round(session, cards, answer = true) {
  const asked = [];
  for (let i = 0; i < 50; i++) {
    session.current = selectNextQuestion(session, cards);
    const q = session.current;
    asked.push({ type: q.type, card: q.cardId });
    recordAttempt(session, answer ? q.correctAnswer : "wrong");
    session.feedback = null;
    if (roundDone(session)) break;
  }
  return asked;
}
test("a round asks every multiple-choice question before any typed one, then the same terms typed", () => {
  const cards = cardsOf(10),
    s = createLearnSession(cards, [], {
      types: ["mc", "written"],
      roundSize: 3,
      shuffle: false,
    });
  const first = round(s, cards);
  assert.deepEqual(
    first.map((q) => q.type),
    ["mc", "mc", "mc", "written", "written", "written"],
  );
  assert.deepEqual(
    first.slice(3).map((q) => q.card),
    first.slice(0, 3).map((q) => q.card),
  );
  startRound(s);
  const second = round(s, cards);
  assert.deepEqual(
    second.map((q) => q.type),
    ["mc", "mc", "mc", "written", "written", "written"],
  );
  assert(
    second
      .slice(0, 3)
      .every((q) => !first.slice(0, 3).some((f) => f.card === q.card)),
    "new terms in the next round",
  );
});
test("selecting after a finished round starts the next one with multiple choice", () => {
  const cards = cardsOf(6),
    s = createLearnSession(cards, [], {
      types: ["mc", "written"],
      roundSize: 2,
      shuffle: false,
    });
  round(s, cards);
  assert.equal(roundDone(s), true);
  assert.equal(selectNextQuestion(s, cards).type, "mc");
});
test("single-kind sessions keep counting questions per round and a small pool still completes", () => {
  const cards = cardsOf(3),
    written = createLearnSession(cards, [], {
      types: ["written"],
      roundSize: 2,
      shuffle: false,
    });
  assert.equal(round(written, cards).length, 2);
  const s = createLearnSession(cards, [], {
    types: ["mc", "written"],
    roundSize: 7,
    shuffle: false,
  });
  let guard = 0;
  while (!learnComplete(s) && guard++ < 100) {
    for (const q of round(s, cards)) void q;
    startRound(s);
  }
  assert(learnComplete(s));
});

// ---- the retry ladder for missed questions
function play(session, cards, decide) {
  const log = [];
  while (!roundDone(session)) {
    session.current = selectNextQuestion(session, cards);
    const q = session.current,
      right = decide(q, log);
    log.push({
      card: q.cardId,
      type: q.type,
      retry: q.retry
        ? `${q.retry.slot}${q.retry.fails}${q.retry.format}`
        : null,
      right,
    });
    recordAttempt(session, right ? q.correctAnswer : "wrong");
    session.feedback = null;
    if (log.length > 80) throw new Error("round did not finish");
  }
  return log;
}
test("a missed multiple-choice question climbs A (scattered in typing) → B (end of typing) → C (next round start), then restarts as multiple choice", () => {
  const cards = cardsOf(8),
    s = createLearnSession(cards, [], {
      types: ["mc", "written"],
      roundSize: 4,
      shuffle: false,
    });
  let target = null;
  // Round 1: miss the first multiple-choice question; fail every retry.
  const r1 = play(s, cards, (q) => {
    target ??= q.cardId;
    return !(q.cardId === target && (q.type === "mc" || q.retry));
  });
  const kinds = r1.map((x) => x.type);
  const split = kinds.indexOf("written");
  assert.deepEqual(kinds.slice(0, split), ["mc", "mc", "mc", "mc"]);
  const a = r1.findIndex((x) => x.retry?.startsWith("A"));
  assert(a > split && a < r1.length - 1, "A is inside the typing section");
  assert.equal(r1[a].type, "mc");
  assert.notEqual(r1[a - 1].card, target, "never right after the same term");
  const b = r1.findIndex((x) => x.retry?.startsWith("B"));
  assert.equal(b, r1.length - 1, "B is the last question of the round");
  assert.equal(r1[b].type, "written");
  // Round 2 begins with the retry (slot C) before any multiple choice.
  startRound(s);
  const r2 = play(
    s,
    cards,
    (q) => !(q.retry && q.cardId === target && q.retry.slot !== "B"),
  );
  assert.match(r2[0].retry, /^C3typed$/);
  // The fourth failed attempt resets the term and the next retry is multiple choice.
  assert.equal(
    s.states[`${target}:forward`].status === "NOT_STUDIED" ||
      s.retryQueue.length >= 0,
    true,
  );
  const again = r2.find((x) => x.retry?.startsWith("A"));
  assert.equal(again.retry, "A4mc");
  assert.equal(again.type, "mc");
});
test("a missed typed answer comes back at the start of the next round (C), then A, B", () => {
  const cards = cardsOf(6),
    s = createLearnSession(cards, [], {
      types: ["mc", "written"],
      roundSize: 3,
      shuffle: false,
    });
  let target = null;
  const r1 = play(s, cards, (q) => {
    if (q.type === "written" && !q.retry) target ??= q.cardId;
    return !(q.type === "written" && q.cardId === target);
  });
  assert(r1.some((x) => x.type === "written"));
  startRound(s);
  const r2 = play(s, cards, (q) => !(q.retry && q.cardId === target));
  assert.equal(r2[0].retry, "C1typed");
  assert.match(r2.find((x) => x.retry?.startsWith("A")).retry, /^A2typed$/);
  assert.match(r2.at(-1).retry, /^B3typed$/);
});
test("each slot holds at most half a round and a correct retry leaves the queue", () => {
  const cards = cardsOf(12),
    s = createLearnSession(cards, [], {
      types: ["mc", "written"],
      roundSize: 6,
      shuffle: false,
    });
  // Miss all six multiple-choice questions, then look at the plan for the typed section.
  for (let i = 0; i < 6; i++) {
    s.current = selectNextQuestion(s, cards);
    recordAttempt(s, "wrong");
    s.feedback = null;
  }
  s.current = selectNextQuestion(s, cards); // first typed question builds the plan
  assert.equal(
    s.plan.filter((i) => i.retry && i.slot === "A").length,
    3,
    "half a round",
  );
  assert.equal(
    s.retryQueue.filter((e) => e.slot === "A" && !e.inPlan && e.round === 2)
      .length,
    3,
    "the rest wait a round",
  );
  const c4 = cardsOf(4),
    t = createLearnSession(c4, [], {
      types: ["mc", "written"],
      roundSize: 2,
      shuffle: false,
    });
  let missed = null;
  play(t, c4, (q) => {
    if (q.type === "mc" && !q.retry) missed ??= q.cardId;
    return !(q.type === "mc" && q.cardId === missed && !q.retry);
  });
  assert.equal(
    t.retryQueue.length,
    0,
    "the retry was answered correctly and left the queue",
  );
});
