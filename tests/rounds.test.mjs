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
