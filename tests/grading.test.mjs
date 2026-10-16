import test from "node:test";
import assert from "node:assert/strict";
import { gradeAnswer, markDifferences } from "../assets/grading.js";
const q = {
  type: "written",
  correctAnswer: "La Città (grande)",
  acceptedAnswers: ["the city"],
};
const result = (grading, answer, extra = {}) =>
  gradeAnswer(answer, q, { grading, ...extra }).correct;
test("strict grading is word for word", () => {
  assert.equal(result("strict", "La Città (grande)"), true);
  assert.equal(
    result("strict", "  La   Città (grande) "),
    true,
    "spacing only",
  );
  assert.equal(result("strict", "la città (grande)"), false, "capitals count");
  assert.equal(result("strict", "La Città"), false, "parentheses count");
  assert.equal(result("strict", "La Citta (grande)"), false, "accents count");
  assert.equal(result("strict", "The city"), false);
  assert.equal(result("strict", "the city"), true, "an approved alternative");
});
test("moderate grading skips parentheses and capitalization", () => {
  assert.equal(result("moderate", "la città"), true);
  assert.equal(result("moderate", "LA CITTÀ (GRANDE)"), true);
  assert.equal(result("moderate", "la città (big)"), true);
  assert.equal(result("moderate", "la citta"), false, "accents still count");
  assert.equal(result("moderate", "la cità"), false, "no misspellings");
  assert.equal(result("moderate", "THE CITY"), true);
  const bare = { type: "written", correctAnswer: "parlare" };
  assert.equal(
    gradeAnswer("Parlare (verbo)", bare, { grading: "moderate" }).correct,
    true,
  );
});
test("relaxed grading also skips accents and forgives one misspelled word", () => {
  assert.equal(result("relaxed", "la citta"), true, "accents");
  assert.equal(result("relaxed", "LA CITTA"), true);
  assert.equal(result("relaxed", "la cità"), true, "one misspelled word");
  assert.equal(result("relaxed", "la ctità"), true, "swapped letters");
  assert.equal(
    result("relaxed", "il città"),
    false,
    "short words are never forgiven",
  );
  assert.equal(
    result("relaxed", "le cità"),
    false,
    "only one word may be wrong",
  );
  assert.equal(result("relaxed", "la città grande"), false);
  const two = { type: "written", correctAnswer: "la grande casa" };
  assert.equal(
    gradeAnswer("la grande cassa", two, { grading: "relaxed" }).correct,
    true,
  );
  assert.equal(
    gradeAnswer("la grande casas", two, { grading: "relaxed" }).correct,
    true,
  );
  assert.equal(
    gradeAnswer("la grandi cassa", two, { grading: "relaxed" }).correct,
    false,
  );
  const long = { type: "written", correctAnswer: "sovranità" };
  assert.equal(
    gradeAnswer("sovrnita", long, { grading: "relaxed" }).correct,
    true,
  );
  assert.equal(
    gradeAnswer("sovrano", long, { grading: "relaxed" }).correct,
    false,
  );
});
test("the older switches still work on top of strict and moderate", () => {
  assert.equal(
    result("strict", "La Citta (grande)", { tolerateAccents: true }),
    true,
  );
  assert.equal(result("moderate", "città", { requireArticles: false }), true);
  assert.equal(gradeAnswer("", q, { grading: "relaxed" }).reason, "Unanswered");
});
test("multiple choice is exact at every level", () => {
  const mc = { type: "mc", correctAnswer: "Roma" };
  for (const grading of ["strict", "moderate", "relaxed"])
    assert.equal(gradeAnswer("roma", mc, { grading }).correct, false);
});
const bad = (segments) => segments.filter((x) => x.bad).map((x) => x.text);
test("mistakes are marked in the response and in the answer", () => {
  const two = { type: "written", correctAnswer: "la grande casa" };
  const d = markDifferences("la grnade casa", two, { grading: "strict" });
  assert.equal(d.differs, true);
  assert.equal(d.response.map((x) => x.text).join(""), "la grnade casa");
  assert(bad(d.response).length && bad(d.answer).length);
  assert.equal(d.answer.map((x) => x.text).join(""), "la grande casa");
  const exact = markDifferences("la grande casa", two, { grading: "strict" });
  assert.equal(exact.differs, false);
});
test("differences the level ignores are never marked", () => {
  assert.equal(
    markDifferences("LA CITTÀ", q, { grading: "moderate" }).differs,
    false,
  );
  assert.equal(
    markDifferences("la citta", q, { grading: "relaxed" }).differs,
    false,
  );
  const strictCaps = markDifferences("la città (grande)", q, {
    grading: "strict",
  });
  assert.deepEqual(bad(strictCaps.response), ["l", "c"]);
  assert.deepEqual(bad(strictCaps.answer), ["L", "C"]);
  const typo = markDifferences("la cità", q, { grading: "relaxed" });
  assert.deepEqual(bad(typo.answer), ["t"]);
  assert.equal(
    markDifferences("", q, {}),
    null,
    "nothing to mark when nothing was typed",
  );
});
test("the closest approved answer is the one compared", () => {
  const d = markDifferences("the cty", q, { grading: "moderate" });
  assert.equal(d.target, "the city");
});
