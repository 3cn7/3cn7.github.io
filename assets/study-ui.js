import { id, now, clone, record, getEligibleCards } from "./core.js";
import {
  DEFAULT_STUDY,
  createFlashcardSession,
  recordSelfAssessment,
  shuffle,
  seededRandom,
  createLearnSession,
  selectNextQuestion,
  roundDone,
  startRound,
  dualRound,
  recordAttempt,
  overrideLearn,
  learnStats,
  learnComplete,
  createTest,
  submitTest,
  testScore,
  retakeTest,
  blankMastery,
} from "./engine.js";
import { gradeAnswer } from "./grading.js";
import { compareClocks, joinClocks } from "./persistence.js";
import { dayKey } from "./streak.js";
import { accentBar, needsAccents, bindAccents } from "./accents.js";
import {
  $,
  esc,
  attr,
  button,
  star,
  toast,
  modal,
  field,
  selectField,
  check,
  empty,
  duration,
  safeImage,
} from "./ui.js";
export function createStudyUI(ctx) {
  const { store } = ctx;
  bindAccents();
  let active = null,
    auto = false,
    autoTimer = null,
    autoDue = 0,
    timerInterval = null,
    busy = false,
    resultFilter = "all";
  // Visible study time, the countdown of a timed test and the Learn feedback moment are
  // kept in memory while a session is on screen and written into the session record.
  let clockStart = 0,
    testClock = null,
    feedbackAt = 0,
    draftTimer = null,
    expiryPrompted = "";
  const filters = [
    ["all", "All terms"],
    ["starred", "Starred only"],
    ["unstarred", "Unstarred"],
    ["notStudied", "Not studied"],
    ["learning", "Still learning"],
    ["mastered", "Mastered"],
    ["missedLatest", "Missed in most recent test per set"],
    ["missedTest", "Missed in any test"],
    ["missedLearn", "Missed in Learn"],
    ["missed", "Missed in either mode"],
  ];
  const directionPairs = [
    ["forward", "Term → Definition"],
    ["reverse", "Definition → Term"],
    ["mixed", "Mixed · both directions required for Learn mastery"],
  ];
  function cards(session = active) {
    return session
      ? session.cardIds
          .map((cid) => store.get(cid))
          .filter((c) => c?.type === "card" && store.get(c.setId))
      : [];
  }
  function title(session = active) {
    return (
      session?.setIds
        .map((sid) => store.get(sid)?.title || "Deleted set")
        .join(" + ") || "Study session"
    );
  }
  let saving = Promise.resolve();
  const ownClocks = new Map();
  async function save() {
    if (!active) return;
    foldActive();
    const pending = clone(active);
    const task = saving
      .catch(() => {})
      .then(async () => {
        const prior = ownClocks.get(pending.id);
        if (prior && compareClocks(pending.clock, prior) === "behind")
          pending.clock = clone(prior);
        const saved = await store.put(pending, { undo: false });
        ownClocks.set(saved.id, clone(saved.clock));
        if (active?.id === saved.id)
          active = {
            ...active,
            clock: clone(saved.clock),
            createdAt: saved.createdAt,
            updatedAt: saved.updatedAt,
          };
      });
    saving = task;
    await task;
  }
  // Navigating away pauses automatic playback but remembers that it was on and how long
  // was left before the next step; a manual action turns it off (stopAuto).
  function pauseAuto() {
    if (auto && active?.mode === "flashcards" && autoDue)
      active.autoRemainingMs = Math.max(0, autoDue - Date.now());
    auto = false;
    autoDue = 0;
    clearTimeout(autoTimer);
    globalThis.speechSynthesis?.cancel();
  }
  function stopAuto() {
    pauseAuto();
    if (active?.mode === "flashcards") {
      active.autoPlay = false;
      active.autoRemainingMs = null;
    }
  }
  const onStudyRoute = () =>
    !!active &&
    /^#(study|test)\//.test(location.hash) &&
    location.hash.split("/")[1] === active.id;
  // Add the visible study time since the last fold to the session.
  function foldActive() {
    if (!active || !clockStart) return;
    const t = Date.now();
    active.activeMs = (active.activeMs || 0) + Math.max(0, t - clockStart);
    clockStart = t;
  }
  // Time spent studying: only while the session is on screen. Sessions saved before this
  // existed fall back to the wall-clock span.
  function elapsedMs(session = active) {
    const tracked =
      session.activeMs == null
        ? null
        : session.activeMs +
          (session === active && clockStart ? Date.now() - clockStart : 0);
    return (
      tracked ??
      Math.max(
        0,
        Date.parse(session.finishedAt || session.submittedAt || now()) -
          Date.parse(session.startedAt),
      )
    );
  }
  // Remember that today was a study day (used by the dashboard streak).
  function engage() {
    const day = dayKey(new Date());
    if (active && !active.days?.includes(day))
      active.days = [...(active.days || []), day];
  }
  const timed = (session = active) =>
    session?.mode === "test" &&
    !session.submittedAt &&
    (session.remainingMs != null || !!session.deadline);
  const remainingOf = (session) =>
    session.remainingMs != null
      ? session.remainingMs
      : session.deadline
        ? session.deadline - Date.now()
        : null;
  function startTestClock() {
    if (!timed() || testClock || document.hidden) return;
    const remaining = remainingOf(active);
    if (remaining <= 0) return promptExpired();
    testClock = {
      deadlineAt: Date.now() + remaining,
      checkpointAt: Date.now(),
    };
    active.timerPaused = false;
  }
  function pauseTestClock() {
    if (!testClock) return false;
    active.remainingMs = Math.max(0, testClock.deadlineAt - Date.now());
    active.timerPaused = true;
    active.timerPausedAt = now();
    testClock = null;
    return true;
  }
  // Called when the learner leaves, hides or closes the page: stops every clock and keeps
  // the session exactly as it is. A timed test is paused, never submitted.
  async function suspend() {
    clearInterval(timerInterval);
    const draftPending = draftTimer !== null;
    clearTimeout(draftTimer);
    draftTimer = null;
    if (!active) return;
    const autoRunning = auto;
    pauseAuto();
    const paused = pauseTestClock(),
      counting = !!clockStart;
    foldActive();
    clockStart = 0;
    if (paused || counting || draftPending || autoRunning)
      await save().catch(() => {});
  }
  async function start(mode, setIds, config, cardIds = null) {
    await suspend();
    active = null;
    auto = false;
    expiryPrompted = "";
    let pool = getEligibleCards(store.records, {
      setIds,
      filter: config.filter,
      direction: config.direction,
      cardIds,
    });
    if (!pool.length)
      throw new Error(
        "No complete terms match this filter. Choose another filter, or add complete cards.",
      );
    if (mode === "learn")
      active = createLearnSession(pool, store.list("learning"), config);
    else if (mode === "test") active = createTest(pool, config);
    else active = createFlashcardSession(pool, config);
    active.label = title(active);
    if (mode === "learn") {
      if (config.goal === "mistakes")
        for (const key of Object.keys(active.states))
          active.states[key] = {
            ...active.states[key],
            status: "LEARNING",
            consecutiveCorrect: 0,
            streakRecall: 0,
            streakRecognition: 0,
            masteredAt: null,
          };
      active.current = selectNextQuestion(active, pool);
    }
    await save();
    for (const sid of setIds)
      await store.update(sid, (s) => ({ ...s, lastStudiedAt: now() }), {
        undo: false,
      });
    ctx.go((mode === "test" ? "test" : "study") + "/" + active.id);
  }
  function configure(
    mode,
    setIds,
    overrides = {},
    cardIds = null,
    { apply = false } = {},
  ) {
    const p = { ...ctx.prefs(), ...overrides };
    const pool = getEligibleCards(store.records, { setIds, cardIds });
    if (!pool.length) {
      toast("Add at least one complete card before studying.");
      return;
    }
    const unfinished = apply ? null : unfinishedFor(mode, setIds);
    const dialog = modal(
      mode === "learn"
        ? "Set up Learn"
        : mode === "test"
          ? "Build your practice test"
          : "Set up Flashcards",
      `${unfinished ? `<div class="notice resume-notice"><div><strong>You have an unfinished ${mode === "test" ? "test" : mode === "learn" ? "Learn session" : "Flashcards session"} for this set.</strong><small class="block">${esc(describe(unfinished))}</small></div>${button("Resume where I left off", unfinished.type === "test" ? "resume-test" : "resume-session", `data-id="${attr(unfinished.id)}"`, "primary small")}</div>` : ""}<p class="muted">${esc(
        setIds
          .map((sid) => store.get(sid)?.title)
          .filter(Boolean)
          .join(" + "),
      )} · ${pool.length} complete terms</p><div class="form-grid">${apply ? "" : selectField("Study pool", "filter", filters, p.filter)}${selectField("Direction", "direction", directionPairs, p.direction)}${
        mode === "learn" && !apply
          ? selectField(
              "Goal",
              "goal",
              [
                ["all", "Learn all · master every selected direction"],
                ["quick", "Quick review · question budget"],
                ["mistakes", "Review mistakes · relearn missed terms"],
                ["starred", "Starred terms only"],
                ["custom", "Custom study · selected pool to mastery"],
              ],
              p.goal,
            ) +
            field(
              "Quick review question budget",
              "budget",
              p.budget,
              "number",
              'min="1" max="10000"',
            )
          : ""
      }${
        mode === "learn"
          ? field(
              "Questions per round (multiple choice first, then the same number typed)",
              "roundSize",
              p.roundSize,
              "number",
              'min="1" max="100"',
            )
          : ""
      }${mode === "test" ? field(`Question count (1–${pool.length}, or enter all)`, "questionCount", Math.min(Number(p.questionCount) || pool.length, pool.length), "text", "required") + field("Optional timer in minutes (0 = off)", "timerMinutes", p.timerMinutes, "number", 'min="0" max="1440"') : ""}${
        mode !== "flashcards"
          ? selectField(
              "Answer grading",
              "grading",
              [
                ["strict", "Strict"],
                ["moderate", "Moderate · conservative typos"],
                ["relaxed", "Relaxed · approved alternatives"],
              ],
              p.grading,
            )
          : ""
      }</div>${mode !== "flashcards" ? `<details class="advanced-study"><summary>Question types and grading options</summary><h3>Question types</h3><div class="row">${[["mc", "Multiple Choice"], ["tf", "True / False"], ["written", "Written Answer"], ...(mode === "learn" ? [["spelling", "Spelling · spoken answer"]] : [])].map(([key, label]) => check(label, key, p.types.includes(key))).join("")}</div><p class="muted" style="margin-top:12px">Small or ambiguous pools fall back to an enabled written format. Recognition-only pools need at least two distinct answers. Written-only mastery needs two consecutive recalls; recognition-only needs three successes.</p><div class="form-grid">${check("Require articles", "requireArticles", p.requireArticles)}${check("Tolerate accent omissions", "tolerateAccents", p.tolerateAccents)}${check("Show explanations in feedback / results", "explanations", p.explanations)}${mode === "learn" ? check("Retype the correct answer after mistakes", "retype", p.retype) + check("Review weak terms first", "weakFirst", p.weakFirst) : ""}</div></details>` : `<details><summary>Playback and review settings</summary><div class="form-grid">${check("Know / Still Learning self-assessment", "selfAssess", p.selfAssess)}${check("Pronounce the term", "speakTerm", p.speakTerm)}${check("Pronounce the definition", "speakDefinition", p.speakDefinition)}${field("Seconds before auto flip", "autoFlip", p.autoFlip, "number", 'min="1" max="60"')}${field("Seconds before advancing", "autoAdvance", p.autoAdvance, "number", 'min="1" max="60"')}${check("Repeat automatic playback", "autoRepeat", p.autoRepeat)}</div></details>`}${
        mode === "test"
          ? `<hr><h3>Question counts by type (0 for automatic balance)</h3><div class="form-grid">${[
              ["mc", "Multiple Choice"],
              ["tf", "True / False"],
              ["written", "Written Answer"],
            ]
              .map(([key, label]) =>
                field(
                  label + " count",
                  "count-" + key,
                  p.typeCounts?.[key] || 0,
                  "number",
                  'min="0" max="50000"',
                ),
              )
              .join(
                "",
              )}${check("Shuffle answer choices", "shuffleAnswers", p.shuffleAnswers)}</div>`
          : ""
      }<hr><div class="row">${check("Shuffle", "shuffle", p.shuffle)}${check("Enable pronunciation buttons", "audio", p.audio)}</div><p class="muted" style="margin-top:12px">Grading uses only the answer and approved alternatives. Italian endings and short words stay distinct. Pronunciation uses your browser’s available voices.</p>`,
      true,
      async (fd) => {
        const types = ["mc", "tf", "written", "spelling"].filter((t) =>
          fd.has(t),
        );
        if (mode !== "flashcards" && !types.length)
          throw new Error("Enable at least one question type.");
        const config = {
          ...p,
          ...Object.fromEntries(fd),
          types: mode === "flashcards" ? p.types : types,
        };
        for (const key of [
          "requireArticles",
          "tolerateAccents",
          "explanations",
          "retype",
          "weakFirst",
          "selfAssess",
          "speakTerm",
          "speakDefinition",
          "autoRepeat",
          "shuffle",
          "shuffleAnswers",
          "audio",
        ])
          config[key] = fd.has(key);
        for (const key of [
          "budget",
          "roundSize",
          "timerMinutes",
          "autoFlip",
          "autoAdvance",
        ])
          config[key] = Number(config[key]);
        if (mode === "test")
          config.typeCounts = Object.fromEntries(
            ["mc", "tf", "written"].map((t) => [
              t,
              Number(fd.get("count-" + t) || 0),
            ]),
          );
        if (config.questionCount !== "all")
          config.questionCount = Number(config.questionCount);
        if (config.goal === "starred") config.filter = "starred";
        if (config.goal === "mistakes" && config.filter === "all")
          config.filter = "missed";
        await ctx.savePrefs(config);
        if (apply) await applyChanges(mode, config);
        else await start(mode, setIds, config, cardIds);
      },
      {
        submitLabel: apply
          ? "Apply and keep going"
          : mode === "test"
            ? "Start test"
            : "Start studying",
      },
    );
    return dialog;
  }
  // Changing direction, question types or grading in the middle of a session keeps its progress.
  async function applyChanges(mode, config) {
    await saving;
    active.config = { ...active.config, ...config };
    const dirs =
      config.direction === "mixed"
        ? ["forward", "reverse"]
        : [config.direction || "forward"];
    if (mode === "flashcards") {
      const rng = seededRandom(active.seed + active.round);
      active.directionByCard = Object.fromEntries(
        active.cardIds.map((cid) => [
          cid,
          config.direction === "mixed"
            ? rng() < 0.5
              ? "forward"
              : "reverse"
            : config.direction,
        ]),
      );
      active.flipped = false;
    } else {
      const progress = store.list("learning");
      for (const card of cards())
        for (const d of dirs) {
          const key = `${card.id}:${d}`,
            have = active.states[key];
          if (!have || have.contentRevision !== card.contentRevision)
            active.states[key] = clone(
              progress.find(
                (p) =>
                  p.id === key && p.contentRevision === card.contentRevision,
              ) || blankMastery(card, d),
            );
        }
      if (!active.feedback && !active.roundSummary && !active.finishedAt) {
        active.current = selectNextQuestion(active, cards());
        active.draft = null;
        active.hint = false;
      }
    }
    await save();
    ctx.render();
    toast("Settings applied. Your progress is kept.");
  }
  const sameSets = (a, b) =>
    a.length === b.length && [...a].sort().join() === [...b].sort().join();
  function unfinishedFor(mode, setIds) {
    return [...store.list("session"), ...store.list("test")]
      .filter(
        (s) =>
          (mode === "test"
            ? s.type === "test" && !s.submittedAt
            : s.type === "session" &&
              s.mode === mode &&
              !s.finishedAt &&
              !(mode === "learn" && learnComplete(s))) &&
          sameSets(s.setIds, setIds),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  }
  // One line saying exactly where a saved session stands.
  function describe(s) {
    if (s.type === "test") {
      const answered = Object.values(s.answers || {}).filter((v) =>
          String(v).trim(),
        ).length,
        left = s.remainingMs ?? (s.deadline ? s.deadline - Date.now() : null);
      return `Test · question ${s.index + 1} of ${s.questions.length} · ${answered} answered${left != null ? " · " + (left > 0 ? duration(left) + " left" : "time expired") : ""}`;
    }
    if (s.mode === "learn") {
      const stats = learnStats(s);
      return `Learn · ${stats.mastered}/${stats.total} mastered · round ${s.round}${s.feedback ? " · answer graded" : s.draft?.answer ? " · answer in progress" : ""}`;
    }
    return s.roundSummary
      ? `Flashcards · round ${s.round} complete`
      : `Flashcards · card ${s.index + 1} of ${s.sequence.length} · ${s.reviewed.length} reviewed${s.flipped ? " · flipped" : ""}`;
  }
  function header(mode) {
    return `<div class="study-header"><div><h1>${esc(title())}</h1><span class="badge">${mode}</span></div><div class="row">${mode !== "Test results" ? button("Shortcuts", "shortcuts", 'aria-keyshortcuts="?" title="Keyboard shortcuts (?)"', "small") : ""}${button("Settings", "session-settings", "", "small")}${button("Save & exit", "exit-study", "", "small")}</div></div>`;
  }
  async function view(sessionId) {
    const found = store.get(sessionId);
    if (!found)
      return empty(
        "Session not found",
        "Open a set and start a new study session.",
      );
    if (active && active.id !== sessionId) await suspend();
    if (!active || active.id !== sessionId) {
      active = clone(found);
      auto = false;
      clockStart = 0;
      testClock = null;
      expiryPrompted = "";
    } else if (
      found.clock &&
      active.clock &&
      compareClocks(found.clock, active.clock) === "ahead"
    )
      // Another tab, a progress reset or sync changed the saved session.
      active = clone(found);
    if (active.type === "test") active.mode = "test";
    if (active.mode === "flashcards") {
      const live = new Set(cards().map((c) => c.id));
      active.cardIds = active.cardIds.filter((cid) => live.has(cid));
      active.sequence = active.sequence.filter((cid) => live.has(cid));
      active.index = Math.min(
        active.index,
        Math.max(0, active.sequence.length - 1),
      );
      return flashView();
    }
    if (active.mode === "learn") {
      const live = cards();
      active.cardIds = live.map((c) => c.id);
      if (active.current && !live.some((c) => c.id === active.current.cardId)) {
        active.current = null;
        active.feedback = null;
      }
      if (!active.current && !active.finishedAt && !active.roundSummary) {
        active.current = selectNextQuestion(active, live);
        await save();
      }
      return learnView();
    }
    return testView();
  }
  function flashSummary() {
    const assessments = active.assessments || {},
      know = Object.values(assessments).filter((v) => v === "know").length,
      learning = Object.values(assessments).filter(
        (v) => v === "learning",
      ).length;
    return `<div class="study-layout">${header("Flashcards")}<div class="panel" style="text-align:center"><div class="eyebrow">ROUND ${active.round} COMPLETE</div><h1>Review complete.</h1><div class="metrics">${summaryMetric(active.reviewed.length, "Reviewed")}${summaryMetric(know, "Know")}${summaryMetric(learning, "Still learning")}${summaryMetric(cards().filter((c) => c.starred).length, "Starred")}</div><p class="muted">${duration(elapsedMs())} studied. Self-assessment is separate from demonstrated Learn mastery.</p><div class="row" style="justify-content:center">${button("Review Still Learning", "flash-review-learning", "", "primary")}${button("Review starred", "review-starred")}${button("Review all", "flash-review-all")}${button("Finish session", "finish-flash")}</div></div></div>`;
  }
  function flashView() {
    if (!active.sequence.length || active.roundSummary || active.finishedAt)
      return flashSummary();
    const card = store.get(active.sequence[active.index]);
    if (!card)
      return empty("No cards remain", "These terms were removed from the set.");
    const dir = active.directionByCard[card.id],
      front = dir === "forward" ? card.term : card.definition,
      back = dir === "forward" ? card.definition : card.term;
    const image = safeImage(card.imageRef);
    return `<div class="study-layout">${header("Flashcards")}<div class="row between" style="margin-bottom:14px"><span class="muted">${active.index + 1} / ${active.sequence.length}</span><div class="row">${star(card)}${active.config.audio ? button("♪ Pronounce", "speak-card", "", "small") : ""}</div></div><button class="study-card ${active.flipped ? "flipped" : ""}" data-action="flip" aria-label="Flip flashcard"><span class="card-side">${active.flipped ? "BACK" : "FRONT"} · ${dir === "forward" ? (active.flipped ? "definition" : "term") : active.flipped ? "term" : "definition"}</span>${image && active.flipped ? `<img src="${attr(image)}" alt="Card illustration" style="max-height:140px;max-width:100%;margin-bottom:15px">` : ""}<span class="card-content">${esc(active.flipped ? back : front)}</span><span class="flip-hint">Click or press Space to flip</span></button><div class="study-controls">${button("←", "flash-prev", 'aria-label="Previous flashcard"')}<span>${active.index + 1} / ${active.sequence.length}</span>${button("→", "flash-next", 'aria-label="Next flashcard"')}${button("Shuffle", "flash-shuffle")}${button("Restart", "flash-restart")}${button(auto ? "Pause auto" : active.autoPlay ? "Resume auto play" : "Auto play", "flash-auto")}</div>${active.config.selfAssess && active.flipped ? `<div class="row" style="justify-content:center">${button("Still Learning", "assess-learning")}${button("Know ✓", "assess-know", "", "primary")}</div>` : ""}<div class="study-metrics"><span>${active.reviewed.length} reviewed</span><span>${Object.values(active.assessments).filter((v) => v === "know").length} Know</span><span>${Object.values(active.assessments).filter((v) => v === "learning").length} Still Learning</span><span>★ ${cards().filter((c) => c.starred).length}</span></div><div class="notice">Space to flip · ← / → to navigate · S to star. Manual interaction pauses automatic playback.</div>${button("Finish review", "flash-complete", "", "small")}</div>`;
  }
  function summaryMetric(value, label) {
    return `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`;
  }
  const hintFor = (q) =>
    `Hint: ${q.correctAnswer.slice(0, 1)}${"·".repeat(Math.min(30, Math.max(0, q.correctAnswer.length - 1)))}`;
  // Italian letter buttons appear when the typed answer is in Italian (or, in Learn, contains accents).
  function accents(q, test, target) {
    const set = store.get(q.setId),
      language =
        q.direction === "forward" ? set?.definitionLanguage : set?.termLanguage;
    return needsAccents(language, test ? "" : q.correctAnswer)
      ? accentBar(target)
      : "";
  }
  function questionForm(q, { test = false, response = "" } = {}) {
    const isChoice = ["mc", "tf"].includes(q.type);
    const spelling = q.type === "spelling";
    return `<div class="panel question-panel"><div class="row between"><span class="eyebrow">${{ mc: "MULTIPLE CHOICE", tf: "TRUE OR FALSE", written: "WRITTEN ANSWER", spelling: "SPELLING" }[q.type]} · ${q.direction === "forward" ? "TERM → DEFINITION" : "DEFINITION → TERM"}</span>${store.get(q.cardId) ? star(store.get(q.cardId)) : ""}</div><div class="question-prompt">${spelling ? "Listen, then spell the answer." : esc(q.prompt)}</div>${q.type === "tf" ? `<div class="notice">${esc(q.statement)}</div>` : ""}${spelling ? button("♪ Hear answer", "speak-question", "", "primary") : !test && active.config.audio ? button("♪ Hear prompt", "speak-prompt", "", "small") : ""}${isChoice ? `<div class="choices">${q.options.map((choice, i) => `<button class="choice ${String(response) === String(choice) ? "selected" : ""}" data-action="${test ? "test-choice" : "learn-choice"}" data-value="${attr(choice)}" ${test ? "" : `aria-keyshortcuts="${i + 1}${q.type === "tf" ? " " + (choice === "true" ? "T" : "F") : ""}"`} ${!test && active.feedback ? "disabled" : ""}><strong>${i + 1}</strong>${esc(q.type === "tf" ? (choice === "true" ? "True" : "False") : choice)}</button>`).join("")}</div>` : `<form id="${test ? "testAnswerForm" : "learnAnswerForm"}"><label>${test ? "Your answer" : "Type your answer"}<input id="writtenAnswer" name="answer" autocomplete="off" value="${attr(response)}" ${!test && active.feedback ? "disabled" : ""}></label>${!active.feedback || test ? accents(q, test, "#writtenAnswer") : ""}${test ? "" : `<div class="row" style="margin-top:16px"><button class="primary" type="submit" ${active.feedback ? "disabled" : ""}>Submit answer</button>${button("Don't know", "dont-know", 'type="button"')}${button("Hint", "learn-hint", 'type="button"')}</div><div id="hintText" class="muted">${active.hint ? esc(hintFor(q)) : ""}</div>`}</form>`}${!test && !active.feedback ? `<p class="shortcut-hint">${isChoice ? `Press ${q.type === "tf" ? "1, 2, T or F" : "1–" + q.options.length} to answer · D for Don’t know` : "Press Enter to submit · Alt+H for a hint"} · <button type="button" class="link-button" data-action="shortcuts">All shortcuts</button></p>` : ""}${!test && isChoice ? `<div class="row" style="margin-top:18px">${button("Don't know", "dont-know", "", active.feedback ? "disabled" : "")}</div>` : ""}</div>`;
  }
  function phaseLabel() {
    if (!dualRound(active)) return "";
    const recognition = (active.roundPhase || "recognition") === "recognition",
      done = recognition
        ? active.phaseKeys?.length || 0
        : active.phaseDone?.length || 0,
      total = recognition
        ? active.config.roundSize
        : active.phaseKeys?.length || 0,
      n = Math.min(total || 1, done + (active.feedback ? 0 : 1));
    return `<span class="badge">${recognition ? "Multiple choice" : "Typing"} · ${n} of ${total || n}</span>`;
  }
  function learnView() {
    const stats = learnStats(active);
    if (
      active.finishedAt ||
      (learnComplete(active) && !active.feedback) ||
      (!active.current && !active.roundSummary)
    )
      return learnSummary(stats, true);
    if (active.roundSummary) return learnSummary(stats, false);
    const a = active.feedback,
      q = active.current;
    return `<div class="study-layout">${header("Learn")}<div class="study-metrics"><span>${stats.mastered}/${stats.total} mastered</span><span>${stats.notStudied} not studied</span><span>${stats.learning} learning</span><span>${Math.round(stats.accuracy)}% accuracy</span><span>${stats.streak} answer streak</span><span>Round ${active.round}</span>${phaseLabel()}</div><div class="progress" style="margin-bottom:24px"><div style="width:${stats.percent}%"></div></div>${questionForm(q, { response: a ? a.response || "" : active.draft?.answer || "" })}${a ? `<div class="feedback ${a.effectiveCorrect ? "good" : "bad"}" role="status"><h3>${a.effectiveCorrect ? "✓ Correct" : "↻ Let’s revisit this term"}</h3><p>Your answer: ${esc(a.response || "Don't know")}</p><p><strong>Correct answer: ${esc(q.type === "tf" ? (q.correctAnswer === "true" ? "True" : "False") : q.correctAnswer)}</strong></p>${active.config.explanations && q.explanation ? `<p>${esc(q.explanation)}</p>` : ""}${a.override ? "<small>Original grade preserved; you marked this response correct.</small>" : ""}${!a.effectiveCorrect ? button("I was correct", "learn-override", "", "small") : ""}${!a.effectiveCorrect && active.config.retype ? `<form id="retypeForm" style="margin-top:15px"><label>Type the correct answer to reinforce it<input name="answer" autocomplete="off" value="${attr(active.draft?.retype || "")}"></label>${accents(q, false, "#retypeForm input")}<button style="margin-top:10px" type="submit">Check retyping</button><span id="retypeStatus" class="muted"></span></form><small>Retyping does not count as an independent recall.</small>` : ""}<div style="margin-top:18px">${button("Continue →", "learn-continue", 'aria-keyshortcuts="Enter"', "primary")}<span class="shortcut-hint inline">or press <kbd>Enter</kbd></span></div></div>` : ""}</div>`;
  }
  function learnSummary(stats, complete) {
    const round = active.attempts.slice(active.roundStart),
      correct = round.filter((a) => a.effectiveCorrect).length;
    return `<div class="study-layout">${header("Learn")}<div class="panel" style="text-align:center"><div class="eyebrow">${complete ? "SESSION COMPLETE" : "ROUND " + active.round + " COMPLETE"}</div><h1>${complete ? (stats.mastered === stats.total ? "All terms mastered." : "Review goal reached.") : "Round complete."}</h1><div class="metrics">${summaryMetric(complete ? stats.attempts : round.length, "Questions")}${summaryMetric(complete ? stats.correct : correct, "Correct")}${summaryMetric(complete ? stats.incorrect : round.length - correct, "Incorrect")}${summaryMetric(stats.mastered + "/" + stats.total, "Mastered terms")}</div><p class="muted">${stats.learning} still learning · ${stats.notStudied} not studied · ${Math.round(stats.accuracy)}% session accuracy · ${duration(elapsedMs())} studied</p><p class="muted">Mastery is calculated for ${active.config.direction === "mixed" ? "both directions" : active.config.direction === "forward" ? "term → definition" : "definition → term"}. A limited review can finish before every term is mastered.</p><div class="row" style="justify-content:center">${complete ? button("Review mistakes", "review-mistakes", "", "primary") + button("Review starred", "review-starred") + button("Practice again", "practice-again") + button("Finish & return", "exit-study") : button("Continue learning →", "continue-round", "", "primary")}</div>${
      complete
        ? `<hr><h3>Most frequently missed</h3>${
            mostMissed()
              .map(
                ([cid, n]) =>
                  `<p>${esc(store.get(cid)?.term || "Deleted term")} · ${n} missed</p>`,
              )
              .join("") || '<p class="muted">No missed answers.</p>'
          }`
        : ""
    }</div></div>`;
  }
  function mostMissed() {
    const counts = new Map();
    for (const a of active.attempts || [])
      if (!a.effectiveCorrect)
        counts.set(a.cardId, (counts.get(a.cardId) || 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }
  function timerText() {
    const remaining = testClock
      ? testClock.deadlineAt - Date.now()
      : remainingOf(active);
    return remaining > 0
      ? duration(remaining) + " remaining"
      : "Time expired · submit when ready";
  }
  function testView() {
    if (active.submittedAt) return testResults();
    const q = active.questions[active.index];
    return `<div class="study-layout">${header("Test")}<div class="row between" style="margin-bottom:20px"><span class="muted">Question ${active.index + 1} / ${active.questions.length} · ${Object.values(active.answers).filter((v) => String(v).trim()).length} answered</span>${timed() ? `<span class="badge" id="testTimer" role="timer">${timerText()}</span>` : ""}${button(active.marked.includes(q.id) ? "Unmark review" : "Mark for review", "test-mark", "", "small")}</div>${questionForm(q, { test: true, response: active.answers[q.id] ?? "" })}<div class="study-controls">${button("← Previous", "test-prev")}${button("Next →", "test-next")}${button("Submit test", "test-submit", "", "primary")}</div><nav class="navigator" aria-label="Test question navigator">${active.questions.map((v, i) => `<button class="${String(active.answers[v.id] ?? "").trim() ? "answered" : ""} ${i === active.index ? "current" : ""} ${active.marked.includes(v.id) ? "marked" : ""}" data-action="test-jump" data-index="${i}" aria-label="Question ${i + 1}${String(active.answers[v.id] ?? "").trim() ? ", answered" : ", unanswered"}${active.marked.includes(v.id) ? ", marked for review" : ""}">${i + 1}</button>`).join("")}</nav><p class="muted" style="font-size:.8rem">Answers and question choices save as you go. You can revisit any question before submission. ${timed() ? "The timer pauses while you are away from this page, and your answers are submitted automatically only if it runs out while you are working." : ""}</p></div>`;
  }
  function testResults() {
    const score = testScore(active),
      rows = active.results.filter(
        (r) =>
          resultFilter === "all" ||
          (resultFilter === "correct" && r.effectiveCorrect) ||
          (resultFilter === "incorrect" && !r.effectiveCorrect) ||
          (resultFilter === "unanswered" && r.unanswered),
      );
    return `<div class="study-layout">${header("Test results")}<div class="panel" style="text-align:center"><div class="eyebrow">YOUR RESULTS</div><div class="score">${Math.round(score.percent)}%</div><p>${score.earned} / ${score.total} correct · ${score.total - score.earned} incorrect · ${score.unanswered} unanswered · ${duration(active.durationMs)}</p>${active.submittedBy === "timer" ? '<p class="muted">The time limit ended, so the answers you had recorded were submitted automatically.</p>' : ""}<div class="row" style="justify-content:center">${button("Review mistakes", "test-mistakes", "", "primary")}${button("Star all incorrect", "star-incorrect")}${button("Retake same test", "retake-test")}${button("Generate new test", "new-test")}</div></div><div class="toolbar"><h2 style="margin:0">Question review</h2><select id="resultFilter" aria-label="Filter test results">${["all", "correct", "incorrect", "unanswered"].map((v) => `<option ${resultFilter === v ? "selected" : ""} value="${v}">${v[0].toUpperCase() + v.slice(1)} questions</option>`).join("")}</select></div>${rows
      .map((r) => {
        const q = active.questions.find((q) => q.id === r.questionId);
        return `<article class="review-row"><div class="row between"><span class="badge ${r.effectiveCorrect ? "success" : "error"}">${r.effectiveCorrect ? "✓ Correct" : r.unanswered ? "Unanswered" : "Incorrect"} · ${esc(q.type)}</span>${store.get(q.cardId) ? star(store.get(q.cardId)) : "<small>Card removed from library</small>"}</div><h3 style="margin-top:15px">${esc(q.prompt)}</h3>${q.type === "tf" ? `<p>${esc(q.statement)}</p>` : ""}<p class="answer">Your answer: ${esc(q.type === "tf" ? (r.response === "true" ? "True" : r.response === "false" ? "False" : "Unanswered") : r.response || "Unanswered")}</p><p>Correct answer: ${esc(q.type === "tf" ? (q.correctAnswer === "true" ? "True" : "False") : q.correctAnswer)}</p>${active.config.explanations && q.explanation ? `<p class="muted">${esc(q.explanation)}</p>` : ""}${r.override ? "<small>Grade overridden; original response and grade are preserved.</small>" : ""}${!r.effectiveCorrect && q.type === "written" ? button("I was correct", "test-override", `data-question="${attr(q.id)}"`, "small") : ""}</article>`;
      })
      .join("")}</div>`;
  }
  async function submit({ timer = false } = {}) {
    if (active.submittedAt) return;
    engage();
    pauseTestClock();
    foldActive();
    submitTest(active);
    // Time actually spent on the test, not the span including time away from the page.
    if (active.activeMs != null) active.durationMs = active.activeMs;
    active.submittedBy = timer ? "timer" : "learner";
    clearInterval(timerInterval);
    await save();
    ctx.render();
    if (timer) toast("Time expired. The recorded answers were submitted.");
  }
  // The countdown only submits while the learner is looking at the test.
  function promptExpired() {
    if (expiryPrompted === active.id) return;
    expiryPrompted = active.id;
    active.remainingMs = 0;
    modal(
      "The time limit ended",
      "<p>The timer ran out while you were away from this test. Your answers are saved and nothing has been submitted. Submit them now, or choose Cancel to keep reviewing; the timer stays at zero until you submit.</p>",
      true,
      () => submit(),
      { submitLabel: "Submit answers" },
    );
  }
  async function expireTest() {
    testClock = null;
    active.remainingMs = 0;
    await submit({ timer: true });
  }
  async function answer(response) {
    if (busy || active.feedback) return;
    busy = true;
    try {
      await saving;
      const q = active.current,
        key = `${q.cardId}:${q.direction}`,
        before = clone(active.states[key]);
      clearTimeout(draftTimer);
      engage();
      foldActive();
      active.draft = null;
      active.hint = false;
      const a = recordAttempt(active, response);
      a.beforeState = before;
      await commitLearn(a, active.states[key], before.clock || {});
      feedbackAt = Date.now();
      ctx.render();
    } finally {
      busy = false;
    }
  }

  async function commitLearn(attempt, mastery, expectedClock) {
    const pendingSession = clone(active),
      pendingMastery = clone(mastery);
    pendingMastery.clock = expectedClock;
    const nextClock = {
      ...expectedClock,
      [store.device]: (expectedClock[store.device] || 0) + 1,
    };
    pendingSession.states[mastery.id].clock = nextClock;
    await store.change(
      "Record learning attempt",
      (rows) => {
        const saved = rows.find((r) => r.id === active.id),
          progress = rows.find((r) => r.id === mastery.id);
        if (
          (saved && compareClocks(active.clock, saved.clock) !== "equal") ||
          (progress && compareClocks(expectedClock, progress.clock) !== "equal")
        )
          throw new Error(
            "This study session or its mastery changed in another tab. Resume the latest session before continuing. Your response is still displayed.",
          );
        const additions = [pendingSession, pendingMastery, attempt],
          ids = new Set(additions.map((r) => r.id));
        return [...rows.filter((r) => !ids.has(r.id)), ...additions];
      },
      { undo: false },
    );
    active = clone(store.get(active.id));
  }
  function speak(text, language) {
    return new Promise((resolve) => {
      if (!globalThis.speechSynthesis) {
        toast("Pronunciation is unavailable in this browser.");
        resolve();
        return;
      }
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = language || "en";
      u.onend = resolve;
      u.onerror = resolve;
      speechSynthesis.speak(u);
    });
  }
  function cardSpeech() {
    const c = store.get(active.sequence[active.index]);
    if (!c) return Promise.resolve();
    const s = store.get(c.setId),
      forward = active.directionByCard[c.id] === "forward",
      termSide = active.flipped ? !forward : forward;
    return speak(
      termSide ? c.term : c.definition,
      termSide ? s?.termLanguage : s?.definitionLanguage,
    );
  }
  function scheduleAuto(delayMs = null) {
    clearTimeout(autoTimer);
    if (
      !auto ||
      !active ||
      active.mode !== "flashcards" ||
      !active.sequence.length
    )
      return;
    const wait =
      delayMs ??
      (active.flipped ? active.config.autoAdvance : active.config.autoFlip) *
        1000;
    autoDue = Date.now() + wait;
    autoTimer = setTimeout(async () => {
      if (!auto) return;
      autoDue = 0;
      const c = store.get(active.sequence[active.index]),
        s = store.get(c?.setId);
      if (!c) return stopAuto();
      if (!active.flipped) {
        active.flipped = true;
        const termSide = active.directionByCard[c.id] !== "forward";
        if (termSide ? active.config.speakTerm : active.config.speakDefinition)
          await cardSpeech();
        await save();
        await ctx.render();
        scheduleAuto();
      } else {
        active.reviewed = [...new Set([...active.reviewed, c.id])];
        if (active.index + 1 >= active.sequence.length) {
          if (active.config.autoRepeat) {
            active.index = 0;
            active.flipped = false;
          } else {
            active.roundSummary = true;
            stopAuto();
          }
        } else {
          active.index++;
          active.flipped = false;
        }
        await save();
        await ctx.render();
        if (auto) {
          const current = store.get(active.sequence[active.index]);
          const termSide = active.directionByCard[current.id] === "forward";
          if (
            termSide ? active.config.speakTerm : active.config.speakDefinition
          )
            await cardSpeech();
          scheduleAuto();
        }
      }
    }, wait);
  }
  function saveDraftSoon() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      draftTimer = null;
      save().catch((e) => toast("Draft save failed: " + e.message));
    }, 400);
  }
  function bind() {
    clearInterval(timerInterval);
    if (!onStudyRoute()) return;
    // Study time and a timed test's countdown run only while this session is on screen.
    if (!document.hidden) {
      if (!clockStart) clockStart = Date.now();
      startTestClock();
    }
    const lf = $("#learnAnswerForm");
    if (lf) {
      lf.onsubmit = (e) => {
        e.preventDefault();
        answer(new FormData(lf).get("answer")).catch((e) => toast(e.message));
      };
      const input = $("#writtenAnswer");
      if (input && !input.disabled) {
        // Unsent answers are kept, so a refresh restores what was typed.
        input.oninput = () => {
          active.draft = { ...active.draft, answer: input.value };
          saveDraftSoon();
        };
        if (matchMedia("(pointer: fine)").matches) input.focus();
      }
    }
    const rf = $("#retypeForm");
    if (rf) {
      rf.onsubmit = (e) => {
        e.preventDefault();
        const result = gradeAnswer(
          new FormData(rf).get("answer"),
          { ...active.current, type: "written", acceptedAnswers: [] },
          { grading: "strict" },
        );
        active.correctivePassed = result.correct;
        $("#retypeStatus").textContent = result.correct
          ? " ✓ Ready to continue."
          : " Try typing the displayed answer exactly.";
        save().catch((e) => toast(e.message));
        if (result.correct) $("[data-action=learn-continue]")?.focus();
      };
      rf.querySelector("input").oninput = (e) => {
        active.draft = { ...active.draft, retype: e.target.value };
        saveDraftSoon();
      };
    }
    // After an answer is graded, keyboard focus moves to Continue (or to the retyping box
    // when the correct answer has to be typed first) instead of being lost on redraw.
    if (active.mode === "learn" && active.feedback) {
      if (rf && !active.correctivePassed) rf.querySelector("input").focus();
      else $("[data-action=learn-continue]")?.focus();
    }
    const tf = $("#testAnswerForm");
    if (tf) {
      tf.onsubmit = (e) => e.preventDefault();
      $("#writtenAnswer").oninput = (e) => {
        engage();
        active.answers[active.questions[active.index].id] = e.target.value;
        save().catch((error) => toast("Answer save failed: " + error.message));
      };
    }
    const filter = $("#resultFilter");
    if (filter)
      filter.onchange = (e) => {
        resultFilter = e.target.value;
        ctx.render();
      };
    if (timed() && testClock) {
      const tick = () => {
        if (!testClock || !onStudyRoute() || active.submittedAt) return;
        const remaining = testClock.deadlineAt - Date.now();
        if ($("#testTimer")) $("#testTimer").textContent = timerText();
        if (remaining <= 0) {
          clearInterval(timerInterval);
          expireTest().catch((e) => toast(e.message));
        } else if (Date.now() - testClock.checkpointAt >= 5000) {
          // Periodic checkpoint: an abrupt close loses at most a few seconds.
          testClock.checkpointAt = Date.now();
          active.remainingMs = remaining;
          save().catch(() => {});
        }
      };
      tick();
      timerInterval = setInterval(tick, 1000);
    }
  }
  async function handle(action, el) {
    const known = new Set([
      "resume-session",
      "resume-test",
      "review-test",
      "discard-session",
      "discard-test",
      "session-settings",
      "exit-study",
      "shortcuts",
      "flip",
      "flash-prev",
      "flash-next",
      "flash-shuffle",
      "flash-restart",
      "flash-auto",
      "flash-complete",
      "assess-know",
      "assess-learning",
      "flash-review-learning",
      "flash-review-all",
      "finish-flash",
      "learn-choice",
      "dont-know",
      "learn-hint",
      "learn-override",
      "learn-continue",
      "continue-round",
      "review-mistakes",
      "review-starred",
      "practice-again",
      "speak-card",
      "speak-question",
      "speak-prompt",
      "test-choice",
      "test-prev",
      "test-next",
      "test-jump",
      "test-mark",
      "test-submit",
      "test-mistakes",
      "retake-test",
      "new-test",
      "star-incorrect",
      "test-override",
    ]);
    if (!known.has(action)) return false;
    if (["resume-session", "resume-test", "review-test"].includes(action)) {
      const saved = store.get(el.dataset.id);
      if (!saved) throw new Error("This saved session no longer exists.");
      if ($("#modal").open) $("#modal").close();
      await suspend();
      active = clone(saved);
      auto = false;
      clockStart = 0;
      testClock = null;
      expiryPrompted = "";
      ctx.go((active.type === "test" ? "test" : "study") + "/" + active.id);
      return true;
    }
    if (action === "shortcuts") {
      showShortcuts();
      return true;
    }
    if (action === "discard-session" || action === "discard-test") {
      modal(
        "Discard unfinished session?",
        "<p>Recorded study attempts are retained. This unfinished session moves to a deletion marker.</p>",
        true,
        async () => {
          await store.remove(el.dataset.id);
          ctx.render();
        },
        { submitLabel: "Discard" },
      );
      return true;
    }
    if (!active) return true;
    await saving;
    if (action !== "flash-auto") stopAuto();
    if (!["exit-study", "session-settings", "discard-session"].includes(action))
      engage();
    if (action === "exit-study") {
      if (
        active.mode === "learn" &&
        learnComplete(active) &&
        !active.finishedAt
      )
        active.finishedAt = now();
      await suspend();
      // The learner may have navigated elsewhere while the session was being saved.
      if (onStudyRoute()) ctx.go("library");
    } else if (action === "session-settings") {
      configure(active.mode, active.setIds, active.config, active.cardIds, {
        apply: active.mode !== "test",
      });
    } else if (action === "flip") {
      active.flipped = !active.flipped;
      active.reviewed = [
        ...new Set([...active.reviewed, active.sequence[active.index]]),
      ];
      await save();
      ctx.render();
    } else if (action === "flash-prev" || action === "flash-next") {
      active.index = Math.max(
        0,
        Math.min(
          active.sequence.length - 1,
          active.index + (action === "flash-next" ? 1 : -1),
        ),
      );
      active.flipped = false;
      await save();
      ctx.render();
    } else if (action === "flash-shuffle") {
      const current = active.sequence[active.index];
      active.sequence = shuffle(active.sequence);
      active.index = Math.max(0, active.sequence.indexOf(current));
      await save();
      ctx.render();
    } else if (action === "flash-restart") {
      active.index = 0;
      active.flipped = false;
      await save();
      ctx.render();
    } else if (action === "flash-auto") {
      auto = !auto;
      if (!auto) stopAuto();
      else {
        const resumeIn = active.autoRemainingMs;
        active.autoPlay = true;
        active.autoRemainingMs = null;
        const card = store.get(active.sequence[active.index]),
          termSide = active.directionByCard[card.id] === "forward";
        if (
          resumeIn == null &&
          (termSide ? active.config.speakTerm : active.config.speakDefinition)
        )
          await cardSpeech();
        if (auto) scheduleAuto(resumeIn);
        await save();
      }
      ctx.render();
    } else if (action === "flash-complete") {
      active.roundSummary = true;
      await save();
      ctx.render();
    } else if (action === "assess-know" || action === "assess-learning") {
      recordSelfAssessment(
        active,
        action === "assess-know" ? "know" : "learning",
      );
      await save();
      ctx.render();
    } else if (
      action === "flash-review-learning" ||
      action === "flash-review-all"
    ) {
      const pool = cards().filter(
        (c) =>
          action === "flash-review-all" ||
          active.assessments[c.id] === "learning",
      );
      if (!pool.length) {
        toast("No Still Learning terms remain.");
        return true;
      }
      active.sequence = pool.map((c) => c.id);
      active.index = 0;
      active.flipped = false;
      active.roundSummary = false;
      active.finishedAt = null;
      active.round++;
      await save();
      ctx.render();
    } else if (action === "finish-flash") {
      active.finishedAt = now();
      await save();
      ctx.go("library");
    } else if (action === "learn-choice") await answer(el.dataset.value);
    else if (action === "dont-know") await answer("");
    else if (action === "learn-hint") {
      active.hint = true;
      $("#hintText").textContent = hintFor(active.current);
      save().catch((e) => toast(e.message));
    } else if (action === "learn-override") {
      const result = overrideLearn(active, cards());
      if (result) {
        await commitLearn(
          result.attempt,
          result.mastery,
          result.prior.clock || {},
        );
        ctx.render();
      }
    } else if (action === "learn-continue") {
      if (
        active.config.retype &&
        !active.feedback.effectiveCorrect &&
        !active.correctivePassed
      ) {
        toast("Retype the displayed correct answer before continuing.");
        return true;
      }
      active.correctivePassed = false;
      active.feedback = null;
      active.current = null;
      if (learnComplete(active)) active.finishedAt = now();
      else if (roundDone(active)) active.roundSummary = true;
      else active.current = selectNextQuestion(active, cards());
      await save();
      ctx.render();
    } else if (action === "continue-round") {
      active.round++;
      active.roundStart = active.position;
      active.roundSummary = false;
      startRound(active);
      active.current = selectNextQuestion(active, cards());
      await save();
      ctx.render();
    } else if (action === "review-mistakes" || action === "test-mistakes") {
      const missed =
        active.mode === "learn"
          ? [
              ...new Set(
                active.attempts
                  .filter((a) => !a.effectiveCorrect)
                  .map((a) => a.cardId),
              ),
            ]
          : active.results
              .filter((r) => !r.effectiveCorrect)
              .map((r) => r.cardId);
      if (!missed.length) {
        toast("No missed terms to review.");
        return true;
      }
      configure(
        "learn",
        active.setIds,
        { ...active.config, filter: "all", goal: "mistakes" },
        missed,
      );
    } else if (action === "review-starred")
      configure(
        active.mode || "learn",
        active.setIds,
        { ...active.config, filter: "starred", goal: "all" },
        active.cardIds,
      );
    else if (action === "practice-again")
      configure(
        "learn",
        active.setIds,
        { ...active.config, goal: "quick", filter: "all" },
        active.cardIds,
      );
    else if (action === "speak-card") await cardSpeech();
    else if (action === "speak-question" || action === "speak-prompt") {
      const q = active.current,
        s = store.get(q.setId),
        answer = action === "speak-question";
      await speak(
        answer ? q.correctAnswer : q.prompt,
        (q.direction === "forward") === answer
          ? s?.definitionLanguage
          : s?.termLanguage,
      );
    } else if (action === "test-choice") {
      active.answers[active.questions[active.index].id] = el.dataset.value;
      await save();
      ctx.render();
    } else if (
      action === "test-prev" ||
      action === "test-next" ||
      action === "test-jump"
    ) {
      active.index =
        action === "test-jump"
          ? Number(el.dataset.index)
          : Math.max(
              0,
              Math.min(
                active.questions.length - 1,
                active.index + (action === "test-next" ? 1 : -1),
              ),
            );
      await save();
      ctx.render();
    } else if (action === "test-mark") {
      const qid = active.questions[active.index].id;
      active.marked = active.marked.includes(qid)
        ? active.marked.filter((id) => id !== qid)
        : [...active.marked, qid];
      await save();
      ctx.render();
    } else if (action === "test-submit") {
      const remaining = active.questions.filter(
        (q) => !String(active.answers[q.id] ?? "").trim(),
      ).length;
      if (remaining)
        modal(
          "Submit with unanswered questions?",
          `<p>${remaining} questions are unanswered and will count as incorrect.</p>`,
          true,
          () => submit(),
          { submitLabel: "Submit anyway" },
        );
      else await submit();
    } else if (action === "retake-test") {
      active = retakeTest(active);
      testClock = null;
      clockStart = 0;
      expiryPrompted = "";
      await save();
      ctx.go("test/" + active.id);
    } else if (action === "new-test")
      configure("test", active.setIds, active.config, active.cardIds);
    else if (action === "star-incorrect") {
      const misses = new Set(
        active.results.filter((r) => !r.effectiveCorrect).map((r) => r.cardId),
      );
      await store.change("Star incorrect terms", (rows) =>
        rows.map((c) =>
          c.type === "card" && misses.has(c.id) ? { ...c, starred: true } : c,
        ),
      );
      ctx.render();
    } else if (action === "test-override") {
      active.results = active.results.map((r) =>
        r.questionId === el.dataset.question
          ? { ...r, effectiveCorrect: true, override: true, overrideAt: now() }
          : r,
      );
      await save();
      ctx.render();
    }
    return true;
  }
  const SHORTCUTS = {
    learn: [
      ["Enter", "Submit a typed answer; after an answer is graded, continue"],
      ["1 – 4", "Choose an answer (T / F for True or False)"],
      ["D", "Don’t know (Alt+D while typing)"],
      ["Alt+H", "Show a hint for a typed answer"],
      ["S", "Star or unstar the term"],
      ["?", "Show these shortcuts"],
      ["Esc", "Save and exit"],
    ],
    flashcards: [
      ["Space", "Flip the card"],
      ["← / →", "Previous or next card"],
      ["S", "Star or unstar the term"],
      ["?", "Show these shortcuts"],
      ["Esc", "Save and exit"],
    ],
    test: [
      [
        "Tab, then Enter",
        "Move between the question controls and activate one",
      ],
      ["?", "Show these shortcuts"],
      ["Esc", "Save and exit; the timer pauses and the test stays open"],
    ],
  };
  function showShortcuts() {
    const rows = SHORTCUTS[active?.mode] || SHORTCUTS.test;
    modal(
      "Keyboard shortcuts",
      `<p class="muted">Shortcuts are ignored while you type in a field, except where noted. Every action is also available with Tab and Enter.</p><dl class="shortcut-list">${rows.map(([key, text]) => `<div><dt><kbd>${esc(key)}</kbd></dt><dd>${esc(text)}</dd></div>`).join("")}</dl>`,
      false,
    );
  }
  const interactive = "input,textarea,select,[contenteditable]";
  document.addEventListener("keydown", (e) => {
    if (!active || $("#modal").open || !onStudyRoute() || e.isComposing) return;
    const typing = !!e.target.closest?.(interactive);
    const control = !!e.target.closest?.(
      "button,a[href],summary,[role=button]",
    );
    // Alt+D / Alt+H work while typing a Learn answer; every other shortcut yields to the field.
    if (
      active.mode === "learn" &&
      e.altKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      !active.feedback &&
      active.current &&
      (e.code === "KeyD" ||
        (e.code === "KeyH" && active.current.type === "written"))
    ) {
      e.preventDefault();
      if (e.code === "KeyD") answer("").catch((err) => toast(err.message));
      else
        handle("learn-hint", { dataset: {} }).catch((err) =>
          toast(err.message),
        );
      return;
    }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    let action;
    if (e.key === "?") {
      e.preventDefault();
      showShortcuts();
      return;
    }
    if (active.mode === "flashcards") {
      action =
        e.code === "Space" && !control
          ? "flip"
          : e.key === "ArrowLeft"
            ? "flash-prev"
            : e.key === "ArrowRight"
              ? "flash-next"
              : null;
      if (e.key.toLowerCase() === "s") {
        const c = store.get(active.sequence[active.index]);
        if (c) {
          e.preventDefault();
          stopAuto();
          store
            .update(c.id, (r) => ({ ...r, starred: !r.starred }))
            .then(() => ctx.render());
        }
      }
    } else if (active.mode === "learn") {
      const key = e.key.toLowerCase();
      if (!active.feedback && active.current && !e.repeat) {
        const q = active.current;
        let choice;
        if (["1", "2", "3", "4"].includes(key))
          choice = q.options?.[Number(key) - 1];
        else if (q.type === "tf" && (key === "t" || key === "f"))
          choice = key === "t" ? "true" : "false";
        if (choice !== undefined) {
          e.preventDefault();
          answer(choice).catch((err) => toast(err.message));
        } else if (key === "d" && !e.target.closest("button,a[href],summary")) {
          e.preventDefault();
          answer("").catch((err) => toast(err.message));
        }
      } else if (key === "s" && active.current) {
        const c = store.get(active.current.cardId);
        if (c) {
          e.preventDefault();
          store
            .update(c.id, (r) => ({ ...r, starred: !r.starred }))
            .then(() => ctx.render());
        }
      }
      // Enter advances only once an answer has been graded, and never while a button or
      // link has focus (Enter already activates those) or a key is being held down.
      if (e.key === "Enter" && !control && !e.repeat) {
        if (active.feedback) {
          if (
            active.config.retype &&
            !active.feedback.effectiveCorrect &&
            !active.correctivePassed
          ) {
            e.preventDefault();
            $("#retypeForm input")?.focus();
          } else if (
            active.feedback.effectiveCorrect ||
            Date.now() - feedbackAt > 400
          ) {
            // A wrong answer needs a moment to be read, so an accidental double Enter is ignored.
            e.preventDefault();
            action = "learn-continue";
          }
        } else if (active.roundSummary) {
          e.preventDefault();
          action = "continue-round";
        }
      }
    }
    if (e.key === "Escape") action = "exit-study";
    if (action) {
      e.preventDefault();
      handle(action, { dataset: {} }).catch((err) => toast(err.message));
    }
  });
  // Leaving or hiding the page pauses every clock; coming back restarts them.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) suspend();
    else if (onStudyRoute()) ctx.render();
  });
  window.addEventListener("pagehide", () => suspend());
  // Route changes away from a session: stop its clocks and save where it stands.
  const leave = () => (active && !onStudyRoute() ? suspend() : undefined);
  const forget = () => {
    clockStart = 0;
    testClock = null;
    active = null;
  };
  return {
    view,
    configure,
    handle,
    bind,
    pauseAuto: stopAuto,
    leave,
    forget,
    describe,
  };
}
