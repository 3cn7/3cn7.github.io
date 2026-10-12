// Study streak: consecutive local calendar days that include at least one real study action.
// Pure functions with no DOM or storage access, so the rules are unit-tested.
const pad = (n) => String(n).padStart(2, "0");
/** Local calendar day ("YYYY-MM-DD") of a Date or ISO timestamp, or null when invalid. */
export function dayKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
// Whole-day index of a calendar day. Using UTC for the arithmetic keeps daylight-saving
// changes (23- and 25-hour days) from shifting the count.
const dayNumber = (key) => {
  const [y, m, d] = key.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
};
const keyOf = (number) => {
  const date = new Date(number * 86400000);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};
/**
 * Days on which the learner actually studied, from records that already exist:
 * - Learn answers (attempt.at);
 * - submitted tests (submittedAt);
 * - `days`, the local days on which a session or test recorded a study action;
 * - for sessions saved before `days` existed: the first and last day of one with reviewed cards/answers.
 * Opening a session without interacting with it never counts.
 */
export function studyDays(records) {
  const days = new Set(),
    add = (value) => {
      const key = dayKey(value);
      if (key) days.add(key);
    };
  for (const r of records) {
    if (r.erased) continue;
    if (r.type === "attempt") add(r.at);
    else if (r.type === "test" || r.type === "session") {
      if (Array.isArray(r.days))
        r.days.forEach((key) => /^\d{4}-\d\d-\d\d$/.test(key) && days.add(key));
      else if (
        r.reviewed?.length ||
        Object.keys(r.assessments || {}).length ||
        Object.keys(r.answers || {}).length
      ) {
        add(r.startedAt);
        add(r.updatedAt);
      }
      if (r.submittedAt) add(r.submittedAt);
    }
  }
  return days;
}
/**
 * @param {object[]} records study records
 * @param {Date} [at] "now", injectable for tests
 * @returns today's status, the current streak in days (and as weeks + days), the best streak
 * and the last seven calendar days.
 */
export function studyStreak(records, at = new Date()) {
  const today = dayNumber(dayKey(at)),
    numbers = new Set(
      [...studyDays(records)]
        .map(dayNumber)
        // A device clock that moved backwards must not produce a streak that ends in the future.
        .filter((n) => n <= today),
    ),
    studiedToday = numbers.has(today);
  // A streak stays alive until the end of the day after the last study day:
  // if you have not studied yet today, count back from yesterday.
  let days = 0;
  for (let n = studiedToday ? today : today - 1; numbers.has(n); n--) days++;
  let best = 0,
    run = 0,
    previous = null;
  for (const n of [...numbers].sort((a, b) => a - b)) {
    run = previous !== null && n === previous + 1 ? run + 1 : 1;
    best = Math.max(best, run);
    previous = n;
  }
  return {
    days,
    weeks: Math.floor(days / 7),
    extraDays: days % 7,
    studiedToday,
    atRisk: days > 0 && !studiedToday,
    best,
    last: [6, 5, 4, 3, 2, 1, 0].map((ago) => {
      const key = keyOf(today - ago);
      return { key, studied: numbers.has(today - ago), today: ago === 0 };
    }),
  };
}
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
/** "5 days"; from one week on also "2 weeks, 3 days". */
export const streakLength = (days) => plural(days, "day");
export function streakWeeks(days) {
  if (days < 7) return "";
  const weeks = Math.floor(days / 7),
    extra = days % 7;
  return plural(weeks, "week") + (extra ? ", " + plural(extra, "day") : "");
}
