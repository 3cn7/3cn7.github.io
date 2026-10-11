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

A timer stores an absolute deadline and automatically submits recorded answers after expiry, including after refresh. Each ordinary question earns one point. Unanswered questions earn zero. Written review overrides preserve original grades. A retake copies the frozen questions into a new attempt; history is never overwritten. Matching and repeated-card policies are not included in this version.

## Persistence and statistics

Sessions save sequence, direction, position, settings, answers, and current questions. Deleted library cards are removed safely from resumed Flashcards/Learn pools. Frozen historical tests continue to render even if their cards have been removed.

Mastery percentage is mastered eligible card IDs / eligible IDs, bounded by 100%. Accuracy uses original independent attempts with effective grades after overrides. Corrective typing is excluded. Statistics show directional mastery, self-assessment, test performance, mistakes, dates, and elapsed session time as distinct measures. Session elapsed time currently includes suspended intervals; an active-engagement timer and long-term spaced repetition are not implemented.
