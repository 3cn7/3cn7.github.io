export function levenshtein(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = temp;
    }
  }
  return row[b.length];
}
/*
 * Answer grading levels.
 *   strict   - word for word: capitals, parentheses and punctuation all count.
 *   moderate - ignores anything in (parentheses) and capital letters.
 *   relaxed  - moderate, plus accents and other marks on letters (a, e, o, u ...) are ignored
 *              and one misspelled word is accepted.
 * "Tolerate accent omissions" and "Require articles" still apply on top of strict and moderate.
 */
export const GRADING_LEVELS = ["strict", "moderate", "relaxed"];
const level = (settings) =>
  GRADING_LEVELS.includes(settings.grading) ? settings.grading : "strict";
const ARTICLE = /^(?:il|lo|la|i|gli|le|un|uno|una|the|a|an)\s+|^(?:l'|un')/iu;
const PARENS = /\([^)]*(?:\)|$)/gu;
const tidy = (value) =>
  String(value ?? "")
    .normalize("NFC")
    .replace(/[’‘]/g, "'")
    .replace(/\s+/gu, " ")
    .trim();
const dropsMarks = (opts) => opts.grading === "relaxed" || opts.tolerateAccents;
const foldChar = (c, opts) => {
  if (opts.grading !== "strict") c = c.toLocaleLowerCase();
  return dropsMarks(opts) ? c.normalize("NFD").replace(/\p{M}/gu, "") : c;
};
function normalized(value, opts) {
  let s = tidy(value);
  if (opts.grading !== "strict") {
    const bare = s.replace(PARENS, " ").replace(/\s+/gu, " ").trim();
    s = (bare || s).toLocaleLowerCase();
  }
  if (dropsMarks(opts)) s = s.normalize("NFD").replace(/\p{M}/gu, "");
  if (opts.requireArticles === false) s = s.replace(ARTICLE, "");
  return s;
}
const resolve = (settings) => ({
  requireArticles: true,
  tolerateAccents: false,
  ...settings,
  grading: level(settings),
});
// Optimal-string-alignment distance: a swapped pair of letters is one mistake.
function typoDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [
    i,
    ...Array(b.length).fill(0),
  ]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}
// Exactly one word may be misspelled; every other word must match. Words under four letters
// (il / la, si / sì ...) are never forgiven because one letter changes their meaning.
function oneWordMisspelled(answer, target) {
  const x = answer.split(" "),
    y = target.split(" ");
  if (x.length !== y.length) return false;
  const different = x.map((w, i) => i).filter((i) => x[i] !== y[i]);
  if (different.length !== 1) return false;
  const [w, t] = [x[different[0]], y[different[0]]];
  return (
    w.length >= 4 &&
    t.length >= 4 &&
    typoDistance(w, t) <= (Math.max(w.length, t.length) >= 9 ? 2 : 1)
  );
}
export function gradeAnswer(response, question, settings = {}) {
  if (question.type === "mc" || question.type === "tf")
    return {
      correct: String(response) === String(question.correctAnswer),
      reason: "Exact choice",
    };
  const opts = resolve(settings);
  const answer = normalized(response, opts),
    accepted = [
      question.correctAnswer,
      ...(question.acceptedAnswers || []),
    ].map((v) => normalized(v, opts));
  if (!answer) return { correct: false, reason: "Unanswered" };
  if (accepted.includes(answer))
    return { correct: true, reason: "Accepted answer" };
  if (
    opts.grading === "relaxed" &&
    accepted.some((target) => oneWordMisspelled(answer, target))
  )
    return { correct: true, reason: "One misspelled word" };
  return { correct: false, reason: "Answer does not match an approved answer" };
}
/*
 * Shows where a response differs from the answer it is closest to. Each side comes back as
 * segments {text, bad}: `bad` marks letters that were wrong or extra in the response, and
 * letters of the answer that were missing or different. Differences the grading level ignores
 * (capitals, parentheses, accents ...) are never marked.
 */
export function markDifferences(response, question, settings = {}) {
  const opts = resolve(settings),
    shown = tidy(response);
  const chars = (text) => {
    const list = Array.from(text),
      skip = Array(list.length).fill(false);
    if (opts.grading !== "strict") {
      for (const m of text.matchAll(PARENS))
        for (let i = 0; i < m[0].length; i++) skip[m.index + i] = true;
    }
    if (opts.requireArticles === false) {
      const lead = ARTICLE.exec(text);
      if (lead) for (let i = 0; i < lead[0].length; i++) skip[i] = true;
    }
    // The space left behind by an ignored (group) is ignored too.
    for (let i = 0; i < list.length; i++)
      if (list[i] === " " && (skip[i - 1] || skip[i + 1])) skip[i] = true;
    return list.map((c, i) => ({ c, key: foldChar(c, opts), skip: skip[i] }));
  };
  const mine = chars(shown);
  const pairs = (target) => {
    const theirs = chars(target),
      a = mine.filter((x) => !x.skip),
      b = theirs.filter((x) => !x.skip);
    const t = Array.from({ length: a.length + 1 }, () =>
      Array(b.length + 1).fill(0),
    );
    for (let i = a.length - 1; i >= 0; i--)
      for (let j = b.length - 1; j >= 0; j--)
        t[i][j] =
          a[i].key === b[j].key
            ? t[i + 1][j + 1] + 1
            : Math.max(t[i + 1][j], t[i][j + 1]);
    const goodMine = new Set(),
      goodTheirs = new Set();
    for (let i = 0, j = 0; i < a.length && j < b.length; ) {
      if (a[i].key === b[j].key) {
        goodMine.add(a[i]);
        goodTheirs.add(b[j]);
        i++;
        j++;
      } else if (t[i + 1][j] >= t[i][j + 1]) i++;
      else j++;
    }
    return { theirs, a, b, goodMine, goodTheirs, score: t[0][0] };
  };
  const candidates = [
    question.correctAnswer,
    ...(question.acceptedAnswers || []),
  ]
    .map((v) => tidy(v))
    .filter(Boolean);
  if (!candidates.length || !shown) return null;
  const ratio = (x) => x.score / Math.max(x.a.length, x.b.length, 1);
  const best = candidates
    .map((target) => ({ target, ...pairs(target) }))
    .sort((x, y) => ratio(y) - ratio(x))[0];
  const join = (list, good) => {
    const out = [];
    for (const x of list) {
      const bad = !x.skip && !good.has(x);
      if (out.length && out[out.length - 1].bad === bad)
        out[out.length - 1].text += x.c;
      else out.push({ text: x.c, bad });
    }
    return out;
  };
  const response2 = join(mine, best.goodMine),
    answer = join(best.theirs, best.goodTheirs);
  return {
    target: best.target,
    response: response2,
    answer,
    differs: response2.some((x) => x.bad) || answer.some((x) => x.bad),
  };
}
