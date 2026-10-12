# Study engine

The engine in `assets/engine.js` is an original implementation. It does not reproduce any proprietary Quizlet algorithm. Core engine functions have no DOM or network dependencies and are exercised with seeded randomness in tests.

## Records and directions

A card has one stable ID and `contentRevision`. Stars belong to that card and work across every mode. Forward means term → definition; reverse means definition → term. Learning states are keyed by `cardId:direction`. Mixed Learn requires mastery in **both** directions. A card mastered only forward remains unmastered in a mixed pool.

Changing term/definition/accepted answers increments only that card's content revision and saves its previous content. On the next question its affected mastery becomes NOT_STUDIED. Attempts and historical test snapshots remain available. Notes, stars, folder moves, and reordering do not invalidate mastery.

## Mastery

`THRESHOLDS` centralizes the numbers:

- Recognition plus written/spelling: two consecutive correct attempts, including written recall in the current success streak.
- Written/spelling only: two consecutive written recalls.
- Recognition only, including true/false: three consecutive correct attempts.
- Incorrect answers reset the consecutive and current-streak recognition/recall counters. Historical attempt, correct, incorrect, recognition, and recall totals remain.

New cards begin with recognition when possible. Learning cards advance to an enabled recall type. When a one-card or ambiguous pool cannot supply recognition distractors, an enabled written type is used. If no valid enabled format can be generated, the UI reports the reason and asks for distinct cards or a written format. It never loops on invalid questions.

`Know` in Flashcards changes only `session.assessments`; it grants no Learn mastery.

## Scheduler and rounds

The scheduler prioritizes due incorrect terms, recognition terms awaiting recall, other learning terms, then new terms. Misses normally wait four question positions (three intervening questions); correct answers wait three positions. It selects a different card when one is available and relaxes spacing for very small pools. A fairness age after roughly two rounds prevents new cards from being starved by persistent failures. Session card order and seeded question randomization make transitions reproducible.

The default round has seven questions; the setup dialog allows 1–100. Rounds preserve the ongoing queue rather than restarting the set.

Learn All, Custom Study, and Starred goals finish only when the frozen eligible IDs are mastered in the configured direction(s). Review Mistakes resets the current selected pool's success streak and relearns it to mastery; history remains. Quick Review includes previously mastered terms and finishes at its explicit question budget. Finishing a limited review does not label unmastered terms as mastered.

## Questions

Multiple choice uses unique, nonempty, normalized answer choices from other pool cards. It excludes declared synonyms and the same normalized prompt. Correct-answer position is randomized. True/false uses an actual correct pairing or a distinct false pairing; it rejects ambiguous pools. The application cannot infer every real-world synonym automatically: add valid alternatives in the editor to exclude them as distractors.

Spelling speaks the target answer using browser pronunciation and asks the learner to type it. The browser must offer speech synthesis/appropriate language voices. Core written grading works offline.

## Grading and overrides

Strict grading normalizes NFC Unicode, capitalization, whitespace, and curly apostrophes. It preserves accents and grammatical endings by default. Articles and accent omission are explicit options. Moderate/relaxed grading can accept a single internal typo on a word of at least six characters while requiring matching first character and last two characters. Short words, Italian gender/number endings, and conjugations remain conservative. Relaxed accepts declared alternative answers; no vague semantic or substring matching is used. AI grading is not implemented.

Don't Know is an original incorrect attempt. Corrective retyping is verified separately and creates no attempt or mastery credit. I Was Correct keeps the original response/grade and applies a reversible transition from the recorded before-state, updating mastery, scheduler counters, accuracy, and streak together. The session, mastery, and attempt are committed in one IndexedDB transaction. A concurrent edit blocks the stale transition.

## Test

A test is generated in full before starting and snapshots prompts, answers, choices, explanations, card revision, and IDs. Default: one question per eligible card at most. Counts by type may be explicitly specified and must total the requested count; otherwise enabled types are balanced. Question shuffling and answer shuffling have separate controls. No feedback is shown before submission.

A timed test keeps its remaining time in the saved test (`remainingMs`; `deadline` is kept for compatibility). The countdown runs only while the test is on screen in a visible tab. Leaving the page, switching tabs, refreshing or closing the browser pauses it, and a checkpoint is written every few seconds, so an abrupt close loses only a few seconds. The test is **never submitted while the learner is away**. If time runs out while the test is being worked on, the recorded answers are submitted with a visible message (`submittedBy: "timer"`). If the saved time is zero when a test is reopened (including tests saved by an earlier version whose `deadline` has passed), a dialog offers Submit answers, or Cancel to keep reviewing with the timer stopped at zero. The recorded duration is the time actually spent in the test (`activeMs`). Each ordinary question earns one point. Unanswered questions earn zero. Written review overrides preserve original grades. A retake copies the frozen questions into a new attempt; history is never overwritten. Matching and repeated-card policies are not included in this version.

## Persistence, resuming and keyboard shortcuts

Sessions save sequence, direction, position, settings, answers and current questions after every action. Flashcards also keep the flipped state, self-assessments and whether automatic playback was on. Learn keeps the current question, graded feedback, corrective-retyping progress, an unsent typed answer and a shown hint (`draft`, `hint`; a typed draft is written about 0.4 s after typing stops and whenever the page is hidden). Tests save answers, marks, the current question and the countdown. Opening a session again after a refresh, a browser restart, navigating elsewhere, or choosing Resume on the dashboard or in the study setup dialog restores exactly that state. Automatic playback is offered as "Resume auto play" instead of restarting by itself. Deleted library cards are removed safely from resumed Flashcards/Learn pools. Frozen historical tests continue to render even if their cards have been removed.

Study time is `activeMs`: time with the session on screen in a visible tab, saved with the session; time away is not counted. `days` lists the local calendar days on which the learner interacted with the session or test (opening one without answering, flipping or choosing adds nothing). The dashboard streak is computed from these, from Learn attempts and from submitted tests (see `assets/streak.js`). These are additive fields on existing records; older records without them keep working.

Learn shortcuts (also listed under **Shortcuts** and on the `?` key): **Enter** submits a typed answer and, once an answer is graded, continues; 1–4 (and T / F for True/False) choose an option; D means Don't know (Alt+D while typing); Alt+H shows a hint; S stars the term; Esc saves and exits. Enter is never intercepted while typing, before grading, while a button or link has focus, or when a key is being held down. After a wrong answer an accidental double Enter is ignored for a moment so the correction can be read. After grading, focus moves to Continue (or to the retyping box).

## Statistics

Mastery percentage is mastered eligible card IDs / eligible IDs, bounded by 100%. Accuracy uses original independent attempts with effective grades after overrides. Corrective typing is excluded. Statistics show directional mastery, self-assessment, test performance, mistakes, dates and study time as distinct measures. Study time uses `activeMs` where a session has it, and the wall-clock span for older sessions. Long-term spaced repetition is not implemented.

Reset Learn progress exists for everything (Settings) and for one set (**More set actions**). Both set mastery back to not studied, keep cards, stars, attempts, saved tests and flashcard progress, and also reset the copy of that mastery held by unfinished Learn sessions, so resuming does not write old progress back.

## Rounds (October 2026)

When a Learn session allows both recognition (multiple choice, true/false) and typed questions, a round is **N recognition questions, then the same terms asked again as typed answers** (N = "Questions per round"). The next round starts with multiple choice on the next terms. A term answered wrongly in the first half is still asked typed, and weak terms are preferred in the following round. Sessions with only one kind of question count N questions per round as before. Changing direction, question types, grading or round size from **Settings** during a session applies to the same session: attempts, mastery (including the other direction's) and the round are kept. The Italian letter buttons (à è é ì ò ó ù, with a capital-letters toggle) appear under typed answers in Italian and in the card editor.

## Missed questions: the retry ladder

With multiple choice and typing both on, each round is: **missed terms from earlier** (slot C), then **N multiple-choice questions**, then **the same terms typed**, with retries mixed in. Slots: **A** = scattered at random places inside this round's typed section (never right after the same term), **B** = the end of this round's typed section, **C** = the start of the next round.

| Missed | Comes back at |
|---|---|
| a multiple-choice question | A (as multiple choice) → B (typed) → C (typed) → A … |
| a typed answer | C (typed) → A (typed) → B (typed) → C … |

Each slot takes at most half a round (rounded up); extra terms wait for the next round. A correct retry leaves the queue. After the **fourth failed attempt** a term goes back to **not studied**, the next retry is **multiple choice**, and after a correct answer it moves on into typing and the ladder again. A retry replaces the term's normal question in the next round, and the same card is never asked twice in a row while anything else is waiting. "I was correct" removes the retry that the corrected answer created. The queue, plan and positions are saved in the session, so resuming restores the same order. Retries are labelled **Review** and the feedback says where the term will come back.

**Mastery** (with both kinds of question on) is: a correct multiple-choice answer, then a correct typed answer, with no mistake between. Later correct answers keep it; a wrong answer ends it. When a pool is too small to build multiple-choice options, a typed answer stands in for the multiple-choice one. Typed-only sessions need two typed answers in a row, and multiple-choice-only sessions need three correct in a row. The set page lists the mastered terms with the direction(s) mastered.
