import { id, now, clone, normalize } from "./core.js";
import { gradeAnswer } from "./grading.js";
export const THRESHOLDS = Object.freeze({
  recall: 2,
  recognition: 3,
  roundSize: 7,
  incorrectSpacing: 4,
  correctSpacing: 3,
});
export const DEFAULT_STUDY = Object.freeze({
  filter: "all",
  direction: "forward",
  types: ["mc", "written"],
  grading: "strict",
  requireArticles: true,
  tolerateAccents: false,
  shuffle: true,
  shuffleAnswers: true,
  weakFirst: true,
  retype: false,
  explanations: true,
  audio: false,
  goal: "all",
  budget: 20,
  roundSize: 7,
  selfAssess: true,
  autoFlip: 3,
  autoAdvance: 4,
  autoRepeat: false,
  speakTerm: false,
  speakDefinition: false,
  questionCount: 20,
  timerMinutes: 0,
});
export function seededRandom(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function shuffle(list, rng = Math.random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
export const directions = (config) =>
  config.direction === "mixed"
    ? ["forward", "reverse"]
    : [config.direction || "forward"];
export function blankMastery(card, direction) {
  return {
    id: `${card.id}:${direction}`,
    type: "learning",
    cardId: card.id,
    setId: card.setId,
    direction,
    contentRevision: card.contentRevision,
    status: "NOT_STUDIED",
    attempts: 0,
    correct: 0,
    incorrect: 0,
    consecutiveCorrect: 0,
    recognition: 0,
    recall: 0,
    streakRecognition: 0,
    streakRecall: 0,
    lastType: null,
    lastResult: null,
    lastSeenAt: null,
    nextEligible: 0,
    masteredAt: null,
  };
}
export function applyAttempt(state, attempt, config) {
  const s = {
    ...state,
    attempts: state.attempts + 1,
    lastSeenAt: attempt.at,
    lastType: attempt.questionType,
    lastResult: attempt.effectiveCorrect,
  };
  const isRecall = ["written", "spelling"].includes(attempt.questionType);
  if (attempt.effectiveCorrect) {
    s.correct++;
    s.consecutiveCorrect++;
    s[isRecall ? "recall" : "recognition"]++;
    s[isRecall ? "streakRecall" : "streakRecognition"]++;
  } else {
    s.incorrect++;
    s.consecutiveCorrect = 0;
    s.streakRecall = 0;
    s.streakRecognition = 0;
  }
  const written = config.types.some((t) => ["written", "spelling"].includes(t)),
    recognition = config.types.some((t) => ["mc", "tf"].includes(t));
  const mastered = written
    ? s.consecutiveCorrect >= THRESHOLDS.recall &&
      s.streakRecall >= (recognition ? 1 : THRESHOLDS.recall)
    : s.consecutiveCorrect >= THRESHOLDS.recognition;
  s.status = mastered ? "MASTERED" : "LEARNING";
  s.masteredAt = mastered ? attempt.at : null;
  s.nextEligible =
    attempt.position +
    (attempt.effectiveCorrect
      ? THRESHOLDS.correctSpacing
      : THRESHOLDS.incorrectSpacing);
  return s;
}
export function recomputeMastery(card, direction, attempts, config) {
  let s = blankMastery(card, direction);
  for (const a of attempts
    .filter(
      (a) =>
        a.cardId === card.id &&
        a.direction === direction &&
        a.contentRevision === card.contentRevision,
    )
    .sort(
      (a, b) =>
        a.at.localeCompare(b.at) ||
        a.position - b.position ||
        a.id.localeCompare(b.id),
    ))
    s = applyAttempt(s, a, a.config || config);
  return s;
}
export function generateQuestion(
  card,
  pool,
  type,
  direction = "forward",
  rng = Math.random,
  allowed = ["mc", "tf", "written"],
  shuffleOptions = true,
) {
  const prompt = direction === "forward" ? card.term : card.definition,
    correct = direction === "forward" ? card.definition : card.term;
  const alternatives =
    direction === "forward"
      ? card.acceptedAnswers || []
      : card.termAnswers || [];
  const excluded = new Set([correct, ...alternatives].map(normalize));
  const seen = new Set(excluded);
  const candidates = shuffle(
    pool
      .filter((c) => c.id !== card.id)
      .sort(
        (a, b) =>
          Number(b.setId === card.setId) - Number(a.setId === card.setId),
      ),
    rng,
  );
  const distractors = [];
  for (const c of candidates) {
    const value = direction === "forward" ? c.definition : c.term;
    const key = normalize(value);
    const synonym =
      direction === "forward" ? c.acceptedAnswers || [] : c.termAnswers || [];
    if (
      !key ||
      seen.has(key) ||
      synonym.some((v) => excluded.has(normalize(v))) ||
      normalize(direction === "forward" ? c.term : c.definition) ===
        normalize(prompt)
    )
      continue;
    seen.add(key);
    distractors.push(value);
  }
  if (["mc", "tf"].includes(type) && !distractors.length) {
    const fallback = allowed.find((t) => ["written", "spelling"].includes(t));
    if (!fallback)
      throw new Error(
        "No unambiguous recognition question can be generated. Enable Written Answer, or add cards with distinct answers.",
      );
    type = fallback;
  }
  const q = {
    id: id(),
    cardId: card.id,
    setId: card.setId,
    type,
    direction,
    prompt,
    correctAnswer: correct,
    acceptedAnswers: clone(alternatives),
    explanation: card.explanation,
    notes: card.notes,
    term: card.term,
    definition: card.definition,
    contentRevision: card.contentRevision,
  };
  if (type === "mc")
    q.options = shuffleOptions
      ? shuffle([correct, ...distractors.slice(0, 3)], rng)
      : [correct, ...distractors.slice(0, 3)];
  if (type === "tf") {
    const truth = rng() >= 0.5;
    q.statement = truth ? correct : distractors[0];
    q.correctAnswer = String(truth);
    q.options = ["true", "false"];
  }
  return q;
}
export function createLearnSession(
  cards,
  progress = [],
  config = {},
  seed = Date.now(),
) {
  if (!cards.length) throw new Error("No terms match this study pool.");
  config = { ...DEFAULT_STUDY, ...config };
  if (!config.types.length)
    throw new Error("Enable at least one question type.");
  const order = config.shuffle
    ? shuffle(
        cards.map((c) => c.id),
        seededRandom(seed),
      )
    : cards.map((c) => c.id);
  const states = {};
  for (const card of cards)
    for (const d of directions(config)) {
      const p = progress.find(
        (p) =>
          p.id === `${card.id}:${d}` &&
          p.contentRevision === card.contentRevision,
      );
      states[`${card.id}:${d}`] = clone(p || blankMastery(card, d));
    }
  return {
    id: id(),
    type: "session",
    mode: "learn",
    cardIds: order,
    setIds: [...new Set(cards.map((c) => c.setId))],
    config,
    seed,
    states,
    position: 0,
    round: 1,
    roundStart: 0,
    attempts: [],
    lastCardId: null,
    current: null,
    feedback: null,
    startedAt: now(),
    finishedAt: null,
    activeMs: 0,
    days: [],
  };
}
export function selectNextQuestion(session, cards) {
  const available = new Map(cards.map((c) => [c.id, c]));
  const rank = new Map(session.cardIds.map((cid, i) => [cid, i]));
  const states = [];
  for (const cardId of session.cardIds) {
    if (!available.has(cardId)) continue;
    for (const d of directions(session.config)) {
      const card = available.get(cardId),
        key = `${cardId}:${d}`;
      let s = session.states[key];
      if (!s || s.contentRevision !== card.contentRevision) {
        s = blankMastery(card, d);
        session.states[key] = s;
      }
      if (s.status !== "MASTERED" || session.config.goal === "quick")
        states.push(s);
    }
  }
  if (!states.length) return null;
  let eligible = states.filter((s) => s.nextEligible <= session.position);
  if (!eligible.length)
    eligible = states.filter(
      (s) => s.nextEligible === Math.min(...states.map((v) => v.nextEligible)),
    );
  const different = eligible.filter((s) => s.cardId !== session.lastCardId);
  if (different.length) eligible = different;
  else {
    const other = states.filter((s) => s.cardId !== session.lastCardId);
    if (other.length) eligible = other;
  }
  const priority = (s) =>
    session.position - s.nextEligible >
    Math.max(14, session.config.roundSize * 2)
      ? -1
      : s.lastResult === false
        ? 0
        : s.status === "LEARNING" &&
            s.lastType &&
            !["written", "spelling"].includes(s.lastType)
          ? 1
          : s.status === "LEARNING"
            ? 2
            : 3;
  eligible.sort(
    (a, b) =>
      (session.config.weakFirst ? priority(a) - priority(b) : 0) ||
      a.nextEligible - b.nextEligible ||
      rank.get(a.cardId) - rank.get(b.cardId) ||
      a.direction.localeCompare(b.direction),
  );
  const s = eligible[0],
    card = available.get(s.cardId),
    types = session.config.types;
  let type;
  if (s.status === "NOT_STUDIED") type = types.includes("mc") ? "mc" : types[0];
  else
    type =
      types.find((t) => ["written", "spelling"].includes(t)) ||
      types[session.position % types.length];
  return generateQuestion(
    card,
    cards,
    type,
    s.direction,
    seededRandom(session.seed + session.position),
    types,
  );
}
export function recordAttempt(session, response, { override = false } = {}) {
  if (!session.current || session.feedback)
    throw new Error("This question has already been submitted.");
  const q = session.current;
  const grade = gradeAnswer(response, q, session.config);
  const a = {
    id: id(),
    type: "attempt",
    sessionId: session.id,
    cardId: q.cardId,
    setId: q.setId,
    direction: q.direction,
    questionType: q.type,
    contentRevision: q.contentRevision,
    response: String(response ?? ""),
    correctAnswer: q.correctAnswer,
    originalCorrect: grade.correct,
    effectiveCorrect: override || grade.correct,
    override,
    reason: grade.reason,
    at: now(),
    position: session.position,
    config: clone(session.config),
  };
  session.states[`${q.cardId}:${q.direction}`] = applyAttempt(
    session.states[`${q.cardId}:${q.direction}`],
    a,
    session.config,
  );
  session.attempts.push(a);
  session.feedback = a;
  session.lastCardId = q.cardId;
  session.position++;
  return a;
}
export function overrideLearn(session, cards) {
  const a = session.feedback;
  if (!a || a.effectiveCorrect) return null;
  a.effectiveCorrect = true;
  a.override = true;
  a.overrideAt = now();
  const card = cards.find((c) => c.id === a.cardId);
  const key = `${a.cardId}:${a.direction}`;
  const prior = session.states[key];
  // Roll back the last transition, preserving history from earlier sessions and its recognition/recall counts.
  const before = a.beforeState;
  if (before) session.states[key] = applyAttempt(before, a, session.config);
  else
    session.states[key] = recomputeMastery(
      card,
      a.direction,
      session.attempts,
      session.config,
    );
  return { attempt: a, mastery: session.states[key], prior };
}
export function learnStats(session) {
  const liveIds = new Set(session.cardIds);
  const grouped = session.cardIds
    .map((cid) =>
      directions(session.config).map((d) => session.states[`${cid}:${d}`]),
    )
    .filter((group) => group.every(Boolean));
  const mastered = grouped.filter((g) =>
      g.every((s) => s.status === "MASTERED"),
    ).length,
    notStudied = grouped.filter((g) =>
      g.every((s) => s.status === "NOT_STUDIED"),
    ).length;
  const correct = session.attempts.filter((a) => a.effectiveCorrect).length;
  let streak = 0;
  for (const a of [...session.attempts].reverse()) {
    if (!a.effectiveCorrect) break;
    streak++;
  }
  return {
    total: liveIds.size,
    mastered,
    notStudied,
    learning: grouped.length - mastered - notStudied,
    percent: grouped.length
      ? Math.min(100, (mastered / grouped.length) * 100)
      : 0,
    attempts: session.attempts.length,
    correct,
    incorrect: session.attempts.length - correct,
    accuracy: session.attempts.length
      ? (correct / session.attempts.length) * 100
      : 0,
    streak,
  };
}
export function learnComplete(session) {
  const s = learnStats(session);
  return session.config.goal === "quick"
    ? s.attempts >= Number(session.config.budget)
    : s.mastered === s.total;
}
export function createFlashcardSession(cards, config = {}, seed = Date.now()) {
  if (!cards.length) throw new Error("No terms match this study pool.");
  config = { ...DEFAULT_STUDY, ...config };
  const rng = seededRandom(seed);
  const sequence = config.shuffle
    ? shuffle(
        cards.map((c) => c.id),
        rng,
      )
    : cards.map((c) => c.id);
  return {
    id: id(),
    type: "session",
    mode: "flashcards",
    cardIds: cards.map((c) => c.id),
    setIds: [...new Set(cards.map((c) => c.setId))],
    sequence,
    index: 0,
    flipped: false,
    round: 1,
    assessments: {},
    reviewed: [],
    directionByCard: Object.fromEntries(
      cards.map((c) => [
        c.id,
        config.direction === "mixed"
          ? rng() < 0.5
            ? "forward"
            : "reverse"
          : config.direction,
      ]),
    ),
    config,
    seed,
    startedAt: now(),
    finishedAt: null,
    activeMs: 0,
    days: [],
  };
}
export function recordSelfAssessment(session, result) {
  const cid = session.sequence[session.index];
  if (!session.flipped) throw new Error("Flip the card before assessing it.");
  session.assessments[cid] = result;
  session.reviewed = [...new Set([...session.reviewed, cid])];
  session.sequence.splice(session.index, 1);
  session.index = Math.min(
    session.index,
    Math.max(0, session.sequence.length - 1),
  );
  session.flipped = false;
}
export function createTest(cards, config = {}, seed = Date.now()) {
  config = { ...DEFAULT_STUDY, ...config };
  if (!cards.length || !config.types.length)
    throw new Error("Choose some terms and at least one question type.");
  const count =
    config.questionCount === "all"
      ? cards.length
      : Number(config.questionCount);
  if (!Number.isInteger(count) || count < 1 || count > cards.length)
    throw new Error(
      `Choose between 1 and ${cards.length} questions; each card is tested once.`,
    );
  let plannedTypes = [];
  if (config.typeCounts && Object.values(config.typeCounts).some(Number)) {
    for (const t of config.types) {
      const amount = Number(config.typeCounts[t] || 0);
      if (!Number.isInteger(amount) || amount < 0)
        throw new Error(
          "Question counts by type must be nonnegative whole numbers.",
        );
      plannedTypes.push(...Array(amount).fill(t));
    }
    if (plannedTypes.length !== count)
      throw new Error(
        "Question counts by type must add up to the total question count.",
      );
  }
  const rng = seededRandom(seed),
    selected = (config.shuffle ? shuffle(cards, rng) : cards).slice(0, count),
    questions = [];
  for (let i = 0; i < selected.length; i++) {
    const d =
      config.direction === "mixed"
        ? rng() < 0.5
          ? "forward"
          : "reverse"
        : config.direction;
    questions.push(
      generateQuestion(
        selected[i],
        cards,
        plannedTypes[i] || config.types[i % config.types.length],
        d,
        rng,
        config.types,
        config.shuffleAnswers,
      ),
    );
  }
  const start = now();
  return {
    id: id(),
    type: "test",
    mode: "test",
    setIds: [...new Set(cards.map((c) => c.setId))],
    cardIds: cards.map((c) => c.id),
    config,
    seed,
    questions,
    answers: {},
    marked: [],
    index: 0,
    startedAt: start,
    deadline:
      config.timerMinutes > 0
        ? Date.parse(start) + config.timerMinutes * 60000
        : null,
    remainingMs: config.timerMinutes > 0 ? config.timerMinutes * 60000 : null,
    activeMs: 0,
    days: [],
    submittedAt: null,
    results: [],
  };
}
export function submitTest(test, at = now()) {
  if (test.submittedAt) return test;
  test.submittedAt = at;
  test.durationMs = Math.max(0, Date.parse(at) - Date.parse(test.startedAt));
  test.results = test.questions.map((q) => {
    const response = test.answers[q.id] ?? "",
      g = gradeAnswer(response, q, test.config);
    return {
      questionId: q.id,
      cardId: q.cardId,
      response,
      originalCorrect: g.correct,
      effectiveCorrect: g.correct,
      reason: g.reason,
      unanswered: String(response).trim() === "",
    };
  });
  return test;
}
export function testScore(test) {
  const earned = test.results.filter((r) => r.effectiveCorrect).length;
  return {
    earned,
    total: test.questions.length,
    percent: test.questions.length ? (earned / test.questions.length) * 100 : 0,
    unanswered: test.results.filter((r) => r.unanswered).length,
  };
}
export function retakeTest(test) {
  return {
    ...clone(test),
    id: id(),
    clock: {},
    answers: {},
    marked: [],
    index: 0,
    results: [],
    startedAt: now(),
    deadline:
      test.config.timerMinutes > 0
        ? Date.now() + test.config.timerMinutes * 60000
        : null,
    remainingMs:
      test.config.timerMinutes > 0 ? test.config.timerMinutes * 60000 : null,
    timerPaused: false,
    timerPausedAt: null,
    submittedBy: null,
    durationMs: null,
    activeMs: 0,
    days: [],
    submittedAt: null,
    retakeOf: test.id,
  };
}
