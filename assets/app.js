import { Store } from "./persistence.js";
import { unlockSite } from "./gate.js";
import { DriveSync } from "./sync.js";
import { GoogleAuth } from "./google-auth.js";
import { prepareStudyOnly } from "./migration.js";
import { createTimer } from "./timer.js";
import { studyStreak, streakLength, streakWeeks } from "./streak.js";
import {
  id,
  now,
  clone,
  record,
  createStudySet,
  createFlashcard,
  updateFlashcard,
  getEligibleCards,
  descendantFolders,
  validateFolderMove,
  parseCards,
  exportCards,
  makeBackup,
  validateBackup,
  normalize,
} from "./core.js";
import { DEFAULT_STUDY, learnComplete } from "./engine.js";
import {
  $,
  esc,
  attr,
  date,
  duration,
  button,
  star,
  toast,
  modal,
  field,
  selectField,
  check,
  empty,
  download,
  confirmAction,
  options,
} from "./ui.js";
import { createStudyUI } from "./study-ui.js";
import { createTranscriptUI } from "./transcript-ui.js";
import { createLibraryUI } from "./library-ui.js";
import { accentBar, needsAccents } from "./accents.js";
await unlockSite();
const store = await new Store().open().catch((error) => {
  $("#view").innerHTML = empty("Local storage could not open", error.message);
  throw error;
});
await prepareStudyOnly(store);
const auth = new GoogleAuth();
const sync = await new DriveSync(store, () => auth).init();
sync.conflicts = (await store.meta("driveConflicts")) || [];
createTimer();
const prefs = () => ({
  ...DEFAULT_STUDY,
  ...store.get("study-preferences")?.study,
});
// Undo is limited to the card creation/editing flow of a set; entries carry this scope.
const cardScope = (sid) => "cards:" + sid;
// Typing saves without redrawing the page, so the Undo button is updated in place.
function syncUndo() {
  const button = $('[data-action="undo-card"]');
  if (!button || route !== "set") return;
  const scope = cardScope(setId),
    can = store.canUndo(scope);
  button.disabled = !can;
  button.setAttribute(
    "aria-label",
    "Undo last card change" + (can ? ": " + store.undo.at(-1).label : ""),
  );
}
let route = "",
  setId = null,
  folderId = null,
  cardQuery = "",
  cardPage = 0,
  editing = false,
  statsSet = "",
  statsFolder = "",
  statsSubject = "",
  statsFrom = "",
  statsTo = "";
const ctx = {
  store,
  sync,
  auth,
  prefs,
  toast,
  render,
  go,
  head,
  debouncedRender,
  poolFor: (setIds, config = {}) =>
    getEligibleCards(store.records, { setIds, ...config }),
  savePrefs: async (study) =>
    store.put(
      {
        ...record("preferences"),
        ...store.get("study-preferences"),
        id: "study-preferences",
        study: { ...prefs(), ...study },
      },
      { undo: false },
    ),
  sets: () => store.list("set"),
};
const library = createLibraryUI(ctx),
  { folderPath, folderOptions, cardsFor, counts, tile } = library;
const study = createStudyUI(ctx),
  transcripts = createTranscriptUI(ctx);
window.addEventListener("hashchange", () => render());
function go(hash) {
  if (location.hash === "#" + hash) render();
  else location.hash = hash;
}
function head(title, description = "", actions = "", eyebrow = "") {
  return `<div class="page-head"><div>${eyebrow ? `<div class="eyebrow">${esc(eyebrow)}</div>` : ""}<h1>${esc(title)}</h1>${description ? `<p>${esc(description)}</p>` : ""}</div>${actions ? `<div class="row">${actions}</div>` : ""}</div>`;
}
// Mastery goes back to "not studied". Cards, stars, attempts and saved tests are untouched.
// Unfinished Learn sessions hold their own copy of the mastery of each term, so it is reset
// there too; otherwise resuming would write the old progress back.
// Two confirmations, then the history behind the Statistics page is erased.
function resetStatistics() {
  const attempts = store.list("attempt").length,
    tests = store.list("test").filter((t) => t.submittedAt).length,
    sessions = store.list("session").filter((x) => x.finishedAt).length;
  modal(
    "Reset statistics? (step 1 of 2)",
    `<p>This permanently erases <strong>${attempts}</strong> recorded answers, <strong>${tests}</strong> saved test results and <strong>${sessions}</strong> finished study sessions. The Statistics page and your study streak start again from zero.</p><p class="muted">Your sets, cards, stars and unfinished sessions are kept. This cannot be undone; download a backup first if unsure.</p>${check("Also reset Learn mastery (every term back to not studied)", "mastery")}`,
    true,
    (fd) => {
      const mastery = fd.has("mastery");
      setTimeout(
        () =>
          modal(
            "Type RESET to confirm (step 2 of 2)",
            `<p>Erase all statistics${mastery ? " and Learn mastery" : ""}?</p><label>Type <strong>RESET</strong> to confirm<input name="word" autocomplete="off" required></label>`,
            true,
            async (fd2) => {
              if (String(fd2.get("word")).trim() !== "RESET")
                throw new Error("Type RESET exactly, in capitals, to confirm.");
              const at = now(),
                erase = (r) => ({
                  id: r.id,
                  type: r.type,
                  clock: r.clock,
                  createdAt: r.createdAt,
                  deleted: true,
                  erased: true,
                  deletedAt: at,
                });
              await store.change("Reset statistics", (rows) => {
                const next = rows.map((r) =>
                  r.deleted
                    ? r
                    : r.type === "attempt" ||
                        (r.type === "test" && r.submittedAt) ||
                        (r.type === "session" && r.finishedAt)
                      ? erase(r)
                      : r.type === "session" || r.type === "test"
                        ? { ...r, days: [], activeMs: 0 }
                        : r,
                );
                return mastery ? resetLearning(next, () => true) : next;
              });
              study.forget();
              await render();
              toast("Statistics reset.");
            },
            { submitLabel: "Erase statistics" },
          ),
        0,
      );
    },
    { submitLabel: "Continue" },
  );
}
function resetLearning(rows, inScope) {
  const reset = (r) => ({
    ...r,
    status: "NOT_STUDIED",
    consecutiveCorrect: 0,
    streakRecall: 0,
    streakRecognition: 0,
    masteredAt: null,
    resetAt: now(),
  });
  return rows.map((r) => {
    if (r.deleted) return r;
    if (r.type === "learning" && inScope(r)) return reset(r);
    if (r.type === "session" && r.mode === "learn" && !r.finishedAt) {
      const keys = Object.keys(r.states || {}).filter((k) =>
        inScope(r.states[k]),
      );
      if (keys.length)
        return {
          ...r,
          states: {
            ...r.states,
            ...Object.fromEntries(keys.map((k) => [k, reset(r.states[k])])),
          },
        };
    }
    return r;
  });
}
function dashboard() {
  const sets = store.list("set"),
    cards = getEligibleCards(store.records),
    mastered = getEligibleCards(store.records, { filter: "mastered" });
  const recent = [...sets]
    .filter((s) => s.lastStudiedAt)
    .sort((a, b) => b.lastStudiedAt.localeCompare(a.lastStudiedAt))
    .slice(0, 3);
  const pinned = sets.filter((s) => s.pinned).slice(0, 3),
    folders = store
      .list("folder")
      .filter((f) => !f.parentId)
      .slice(0, 4);
  // Only the most recent unfinished card session and the most recent unfinished test: no history.
  const latest = (rows) =>
    rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const sessions = [
    latest(
      store
        .list("session")
        .filter(
          (s) => !s.finishedAt && !(s.mode === "learn" && learnComplete(s)),
        ),
    ),
    latest(store.list("test").filter((t) => !t.submittedAt)),
  ]
    .filter(Boolean)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const history = store
    .list("test")
    .filter((t) => t.submittedAt)
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
    .slice(0, 3);
  const notes = store
    .list("transcript")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 3);
  return (
    head("Dashboard") +
    transcripts.offer() +
    `<section class="hero panel">${streakCard()}<div class="hero-art" aria-hidden="true"><div class="art-back"></div><div class="art-card"><small>ITALIAN</small><strong>ciao</strong><span>hello</span><i>✦</i></div></div></section>
 <div class="metrics">${metric(sets.length, "Study sets", "📁")}${metric(cards.length, "Flashcards", "📄")}${metric(mastered.length, "Mastered · term → definition", "✓")}${metric(store.list("transcript").length, "Transcripts", "🎙️")}</div>
 ${sessions.length ? `<section class="panel stack"><h2>Pick up where you left off</h2>${sessions.map((s) => `<div class="resume-row"><div><strong>${esc(s.setIds.map((id) => store.get(id)?.title || "Study set").join(" + "))}</strong><small>${esc(study.describe(s))} · started ${date(s.startedAt)}</small></div>${button(s.type === "test" ? "Resume test" : "Resume", "resume-" + (s.type === "test" ? "test" : "session"), `data-id="${attr(s.id)}"`, "primary")}${button("Discard", "discard-" + (s.type === "test" ? "test" : "session"), `data-id="${attr(s.id)}"`, "small danger")}</div>`).join("")}</section>` : ""}
 <div class="section-line"><h2>Recently studied</h2><a href="#library">View library →</a></div>${recent.length ? `<div class="grid">${recent.map((s) => tile(s)).join("")}</div>` : empty("No recent study sessions", "Create a set to start practicing.", button("Create a study set", "new-set", "", "primary"))}
 ${pinned.length ? `<div class="section-line"><h2>Pinned sets</h2></div><div class="grid">${pinned.map((s) => tile(s)).join("")}</div>` : ""}
 <div class="two-col dashboard-bottom"><section class="panel"><div class="row between"><h2>Folders</h2>${button("+ Folder", "new-folder", "", "small")}</div>${folders.map((f) => `<a class="folder-link" href="#folder/${attr(f.id)}"><span>📁 ${esc(f.name)}</span><span>→</span></a>`).join("") || '<p class="muted">No folders yet.</p>'}</section><section class="panel"><h2>Recent transcripts</h2>${notes.map((t) => `<a class="folder-link" href="#transcripts/${attr(t.id)}"><span>${esc(t.title)}</span><small>${date(t.updatedAt)}</small></a>`).join("") || '<p class="muted">No recordings yet.</p>'}<a href="#transcripts">View transcripts →</a></section></div>
 ${history.length ? `<div class="section-line"><h2>Recent tests</h2><a href="#statistics">All results →</a></div><section class="panel stack">${history.map((t) => `<div class="row between"><span>${esc(t.setIds.map((id) => store.get(id)?.title || "Study set").join(", "))} · ${t.results.filter((r) => r.effectiveCorrect).length}/${t.questions.length}</span>${button("Review test", "review-test", `data-id="${attr(t.id)}"`)}</div>`).join("")}</section>` : ""}`
  );
}
function streakCard() {
  const streak = studyStreak(store.records),
    weeks = streakWeeks(streak.days),
    status = streak.studiedToday
      ? "You studied today. Come back tomorrow to keep it going."
      : streak.atRisk
        ? `Study today to keep your ${streakLength(streak.days)} going.`
        : "Answer a Learn question, review a flashcard, or submit a test to start a streak.";
  return `<div class="streak"><div class="eyebrow">STUDY STREAK</div><h2 id="streakValue" aria-label="Study streak: ${attr(streakLength(streak.days))}${weeks ? ", " + attr(weeks) : ""}"><span class="streak-days">${streak.days}</span> ${streak.days === 1 ? "day" : "days"}</h2>${weeks ? `<p class="streak-weeks">${esc(weeks)}</p>` : ""}<p class="streak-status">${esc(status)}</p><ol class="streak-week" aria-label="Last 7 days">${streak.last.map((d) => `<li class="${d.studied ? "studied" : ""}${d.today ? " today" : ""}" aria-label="${attr(new Date(d.key + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }))}${d.today ? " (today)" : ""}: ${d.studied ? "studied" : "no study"}"><span aria-hidden="true">${esc(new Date(d.key + "T12:00:00").toLocaleDateString(undefined, { weekday: "narrow" }))}</span></li>`).join("")}</ol><details class="streak-help"><summary>How it’s counted</summary><p>One day counts when you answer a Learn question, review a flashcard, answer a test question, or submit a test, using your device’s local calendar day. Several sessions in one day count once. The streak continues through today until midnight, and a day with no study ends it.${streak.best > streak.days ? ` Your best streak is ${esc(streakLength(streak.best))}.` : ""}</p></details></div>`;
}
function metric(value, label, mark = "") {
  return `<div class="metric"><span class="mark" aria-hidden="true">${mark}</span><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
}
function setView() {
  const set = store.get(setId);
  if (!set)
    return empty(
      "Set not found",
      "It may be in Recently Deleted.",
      `<a class="button" href="#library">Return to library</a>`,
    );
  const c = counts(setId),
    filtered = c.cards.filter(
      (c) =>
        !cardQuery ||
        normalize(c.term + " " + c.definition + " " + c.notes).includes(
          normalize(cardQuery),
        ),
    ),
    page = filtered.slice(cardPage * 40, cardPage * 40 + 40);
  return (
    head(
      set.title,
      set.description || `${c.terms} terms · ${folderPath(set.folderId)}`,
      button("Set details", "set-details", `data-id="${attr(set.id)}"`) +
        button(
          editing ? "Done editing" : "Edit cards",
          "toggle-edit",
          "",
          "primary",
        ),
      set.subject || "STUDY SET",
    ) +
    `<div class="row">${["flashcards", "learn", "test"].map((mode) => button(mode === "flashcards" ? "Flashcards" : mode === "learn" ? "Learn" : "Test", "configure", `data-mode="${mode}" data-sets="${attr(set.id)}"`, mode === "learn" ? "primary" : "")).join("")}${button("Import cards", "import-cards", `data-id="${attr(set.id)}"`)}<details class="context-menu"><summary>More set actions</summary><div>${button("Export", "export-set", `data-id="${attr(set.id)}"`)}${button("Duplicate", "duplicate-set", `data-id="${attr(set.id)}"`)}${button("Reset Learn progress", "reset-set-progress", `data-id="${attr(set.id)}"`, "danger")}${button("Delete set", "delete-set", `data-id="${attr(set.id)}"`, "danger")}</div></details></div><div class="study-metrics" style="justify-content:start"><span>${c.terms} terms</span><span>★ ${c.starred} starred</span><span>${c.mastered} mastered → definition</span><span>Modified ${date(c.modifiedAt)}</span></div><div class="toolbar"><input id="cardSearch" type="search" value="${attr(cardQuery)}" placeholder="Search this set…" aria-label="Search cards">${button("+ Add card", "add-card", `data-id="${attr(set.id)}"`, "primary")}${button("Bulk edit", "bulk-edit", `data-id="${attr(set.id)}"`)}${editing || store.canUndo(cardScope(set.id)) ? button("↩️ Undo", "undo-card", `aria-label="Undo last card change${store.canUndo(cardScope(set.id)) ? ": " + attr(store.undo.at(-1).label) : ""}" title="Undo the last card change in this set" ${store.canUndo(cardScope(set.id)) ? "" : "disabled"}`) : ""}</div>${editing && (needsAccents(set.termLanguage) || needsAccents(set.definitionLanguage)) ? `<div class="accent-editor">${accentBar("", "Italian letters for the focused card field")}</div>` : ""}${termOverview(set)}<div id="cardList">${page.map((c, i) => cardRow(c, cardsFor(set.id).indexOf(c) + 1)).join("") || empty("Add your first card", "A term on one side. A definition, translation, or explanation on the other.")}</div>${filtered.length > 40 ? `<div class="pagination">${button("← Previous", "card-prev", cardPage ? "" : "disabled")}<span>${cardPage + 1} / ${Math.ceil(filtered.length / 40)}</span>${button("Next →", "card-next", (cardPage + 1) * 40 >= filtered.length ? "disabled" : "")}</div>` : ""}`
  );
}
// Every term of the set grouped as Not studied, Learning or Mastered (a term is only Mastered when
// every direction that has been studied is mastered).
const STATUS_GROUPS = [
  [
    "NOT_STUDIED",
    "Not studied",
    "Not answered yet, or started over after four missed attempts",
  ],
  ["LEARNING", "Learning", "Answered, but not yet mastered"],
  ["MASTERED", "Mastered", "Multiple choice, then typed correctly"],
];
function termOverview(set) {
  const cards = cardsFor(set.id).filter(
      (c) => c.term.trim() && c.definition.trim(),
    ),
    progress = store.list("learning"),
    groups = { NOT_STUDIED: [], LEARNING: [], MASTERED: [] };
  for (const c of cards) {
    const states = progress.filter(
      (m) => m.cardId === c.id && m.contentRevision === c.contentRevision,
    );
    const kinds = states.map((m) => m.status),
      status =
        !kinds.length || kinds.every((k) => k === "NOT_STUDIED")
          ? "NOT_STUDIED"
          : kinds.every((k) => k === "MASTERED" || k === "NOT_STUDIED") &&
              kinds.includes("MASTERED") &&
              !kinds.includes("LEARNING")
            ? "MASTERED"
            : "LEARNING";
    groups[status].push([c, states]);
  }
  const chip = (m) =>
    `<small class="status-chip ${m.status.toLowerCase().replace("_", "-")}" title="${attr(m.status === "MASTERED" ? "Mastered " + date(m.masteredAt) : m.status === "LEARNING" ? "Learning" : "Not studied")}">${m.direction === "forward" ? "term → definition" : "definition → term"}</small>`;
  return `<section class="term-overview" aria-label="Term overview"><div class="status-pills">${STATUS_GROUPS.map(([key, label]) => `<span class="status-pill ${key.toLowerCase().replace("_", "-")}"><strong>${groups[key].length}</strong> ${label}</span>`).join("")}</div>${STATUS_GROUPS.map(
    ([key, label, hint]) =>
      `<details class="status-group ${key.toLowerCase().replace("_", "-")}" open><summary><span>${label} (${groups[key].length})</span><small>${hint}</small></summary>${
        groups[key].length
          ? `<ul class="status-list ${key === "MASTERED" ? "mastered-list" : ""}">${groups[
              key
            ]
              .map(
                ([c, states]) =>
                  `<li><span class="mastered-term">${esc(c.term)}</span><span class="mastered-def">${esc(c.definition)}</span><span class="mastered-dirs">${states
                    .filter((m) => m.status === key || key === "LEARNING")
                    .sort((x, y) => x.direction.localeCompare(y.direction))
                    .map(chip)
                    .join("")}</span></li>`,
              )
              .join("")}</ul>`
          : '<p class="muted status-empty">No terms here.</p>'
      }</details>`,
  ).join("")}</section>`;
}
function cardRow(c, index) {
  return `<article class="card-row" id="card-${attr(c.id)}"><span class="card-number">${index}</span><div>${editing ? `<label>Term<textarea data-card-field="term" data-id="${attr(c.id)}">${esc(c.term)}</textarea></label>` : `<small>TERM</small><p>${esc(c.term)}</p>`}</div><div class="definition">${editing ? `<label>Definition<textarea data-card-field="definition" data-id="${attr(c.id)}">${esc(c.definition)}</textarea></label>` : `<small>DEFINITION</small><p>${esc(c.definition)}</p>`}</div><div class="card-star">${star(c)}</div>${editing ? `<details class="card-details"><summary>Accepted answers, notes, and extras</summary><div class="form-grid">${["acceptedAnswers", "termAnswers", "tags"].map((key) => `<label>${key === "acceptedAnswers" ? "Accepted definition answers" : key === "termAnswers" ? "Accepted term answers" : "Tags"} (one per line)<textarea data-card-field="${key}" data-id="${attr(c.id)}">${esc((c[key] || []).join("\n"))}</textarea></label>`).join("")}${["notes", "explanation", "imageRef"].map((key) => `<label>${esc(key)}<textarea data-card-field="${key}" data-id="${attr(c.id)}">${esc(c[key])}</textarea></label>`).join("")}</div></details>` : c.notes ? `<div class="card-details muted"><small>${esc(c.notes)}</small></div>` : ""}<div class="card-tools">${c.provenance?.transcriptId ? `<a class="button small" href="#transcripts/${attr(c.provenance.transcriptId)}${Number.isFinite(c.provenance.timestamp) ? "/" + c.provenance.timestamp : ""}">Source transcript${Number.isFinite(c.provenance.timestamp) ? " · " + duration(c.provenance.timestamp * 1000) : ""}</a>` : ""}${button("Edit", "edit-card", `data-id="${attr(c.id)}"`, "small")}<details class="context-menu"><summary>More</summary><div>${button("Duplicate", "duplicate-card", `data-id="${attr(c.id)}"`, "small")}${button("↑", "move-card", `data-id="${attr(c.id)}" data-step="-1" aria-label="Move card up"`, "small")}${button("↓", "move-card", `data-id="${attr(c.id)}" data-step="1" aria-label="Move card down"`, "small")}${button("Delete", "delete-card", `data-id="${attr(c.id)}"`, "small danger")}</div></details></div></article>`;
}
function editSet(sid) {
  let set = sid ? store.get(sid) : createStudySet({ folderId });
  try {
    const saved = JSON.parse(localStorage.getItem("studyPlatform.setDraft"));
    if (saved && saved.sid === (sid || null)) set = saved.set;
  } catch {}
  const dialog = modal(
    sid ? "Set details" : "Create a study set",
    `<div class="form-grid">${field("Title", "title", set.title === "Untitled set" ? "" : set.title, "text", 'required maxlength="300"')}<label>Description<textarea name="description">${esc(set.description)}</textarea></label>${field("Subject", "subject", set.subject)}${selectField("Folder", "folderId", folderOptions(), set.folderId)}${field("Term language (language code)", "termLanguage", set.termLanguage)}${field("Definition language (language code)", "definitionLanguage", set.definitionLanguage)}</div>`,
    true,
    async (fd) => {
      const value = {
        ...set,
        ...Object.fromEntries(fd),
        folderId: fd.get("folderId") || null,
      };
      if (!value.title.trim()) throw new Error("Give the set a title.");
      await store.put(value);
      localStorage.removeItem("studyPlatform.setDraft");
      setId = value.id;
      editing = true;
      go("set/" + value.id);
    },
  );
  dialog.addEventListener("input", () => {
    const values = Object.fromEntries(
      new FormData(dialog.querySelector("form")),
    );
    localStorage.setItem(
      "studyPlatform.setDraft",
      JSON.stringify({
        sid: sid || null,
        set: { ...set, ...values, folderId: values.folderId || null },
      }),
    );
  });
}
function editFolder(fid) {
  const f = fid
    ? store.get(fid)
    : record("folder", { name: "", parentId: folderId });
  modal(
    fid ? "Edit folder" : "New folder",
    `<div class="form-grid">${field("Folder name", "name", f.name, "text", "required")}${selectField(
      "Parent folder",
      "parentId",
      folderOptions().filter(([k]) => k !== f.id),
      f.parentId,
    )}</div>`,
    true,
    async (fd) => {
      const parentId = fd.get("parentId") || null;
      validateFolderMove(store.records, f.id, parentId);
      await store.put({ ...f, name: String(fd.get("name")).trim(), parentId });
      render();
    },
  );
}
function deleteFolder(fid) {
  const f = store.get(fid),
    desc = descendantFolders(store.records, fid);
  modal(
    "Delete " + f.name,
    `<p>Choose what happens to this folder and its subfolders.</p>${selectField(
      "Contents",
      "policy",
      [
        ["move", "Keep sets and move them to the parent folder"],
        ["delete", "Move folder and all contents to Recently Deleted"],
      ],
      "move",
    )}`,
    true,
    async (fd) => {
      const policy = fd.get("policy");
      await store.change("Delete folder", (rows) => {
        const sets = new Set(
          rows
            .filter(
              (r) => !r.deleted && r.type === "set" && desc.has(r.folderId),
            )
            .map((s) => s.id),
        );
        const marker = { deleted: true, deletedAt: now(), deletedWith: fid };
        return rows.map((r) =>
          r.deleted
            ? r
            : r.type === "folder" && desc.has(r.id)
              ? { ...r, ...marker }
              : r.type === "set" && sets.has(r.id)
                ? policy === "move"
                  ? { ...r, folderId: f.parentId }
                  : { ...r, ...marker }
                : policy === "delete" && r.type === "card" && sets.has(r.setId)
                  ? { ...r, ...marker }
                  : r,
        );
      });
      if (folderId === fid) go("library");
      else render();
    },
    { submitLabel: "Delete folder" },
  );
}
function importCards(sid = null) {
  const dialog = modal(
    sid ? "Import cards into this set" : "Import a study set",
    `<div class="form-grid">${sid ? "" : field("Set title", "title", "", "text", "required")}${selectField(
      "Format",
      "format",
      [
        ["tsv", "Tab-separated / structured text"],
        ["csv", "CSV"],
        ["json", "JSON"],
      ],
      "tsv",
    )}${field("Separator for structured text (TAB or one character)", "separator", "TAB")}<label class="wide">Choose a file<input type="file" id="importFile" accept=".csv,.tsv,.txt,.json"></label><label class="wide">Paste terms and definitions<textarea name="text" id="importText" rows="9" placeholder="ciao&#9;hello"></textarea></label></div><div id="importPreview" class="notice">Paste or select a file to preview it. Blank terms or definitions will be saved as drafts and excluded from studying.</div>`,
    true,
    async (fd) => {
      const rows = parseCards(
        fd.get("text"),
        fd.get("format"),
        fd.get("separator") === "TAB" ? "\t" : fd.get("separator"),
      );
      if (!rows.length) throw new Error("No cards were found.");
      const imported =
        fd.get("format") === "json" ? JSON.parse(fd.get("text"))?.set : null;
      const set = sid
        ? store.get(sid)
        : createStudySet({
            description: imported?.description || "",
            subject: imported?.subject || "",
            termLanguage: imported?.termLanguage || "it",
            definitionLanguage: imported?.definitionLanguage || "en",
            title: String(fd.get("title")),
            folderId,
          });
      if (!set) throw new Error("The destination set was deleted.");
      const start = cardsFor(set.id).length;
      const values = rows.map((r, i) => createFlashcard(set.id, r, start + i));
      await store.putMany(
        [set, ...values],
        sid ? { scope: cardScope(sid) } : {},
      );
      editing = false;
      go("set/" + set.id);
      toast(`${values.length} cards imported.`);
    },
    { submitLabel: "Add imported cards" },
  );
  const preview = () => {
    try {
      const fd = new FormData(dialog.querySelector("form")),
        rows = parseCards(
          fd.get("text"),
          fd.get("format"),
          fd.get("separator") === "TAB" ? "\t" : fd.get("separator"),
        );
      $("#importPreview").textContent =
        `${rows.length} cards · ${rows.filter((r) => !r.term.trim() || !r.definition.trim()).length} incomplete drafts · duplicates are kept as independent cards. Preview: ${rows
          .slice(0, 3)
          .map((r) => r.term + " → " + r.definition)
          .join(" / ")}`;
    } catch (e) {
      $("#importPreview").textContent = e.message;
    }
  };
  dialog.addEventListener("input", preview);
  $("#importFile").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    $("#importText").value = await file.text();
    dialog.querySelector("[name=format]").value = file.name.endsWith(".json")
      ? "json"
      : file.name.endsWith(".csv")
        ? "csv"
        : "tsv";
    preview();
  };
}
function exportSet(sid) {
  const set = store.get(sid);
  modal(
    "Export " + set.title,
    `${selectField(
      "Format",
      "format",
      [
        ["json", "JSON · all metadata and set languages"],
        ["csv", "CSV · card metadata"],
        ["tsv", "Tab-separated · terms and definitions only"],
      ],
      "json",
    )}<p class="muted" style="margin-top:14px">JSON retains the set and card metadata. CSV retains accepted answers, notes, stars, tags, and explanations; set languages stay in JSON. Plain text retains only terms and definitions.</p>`,
    true,
    (fd) => {
      const format = fd.get("format");
      download(
        set.title.replace(/[^\p{L}\p{N} _-]/gu, "") + "." + format,
        exportCards(set, cardsFor(sid), format),
        format === "json" ? "application/json" : "text/plain;charset=utf-8",
      );
    },
    { submitLabel: "Download" },
  );
}
function bulkEdit(sid) {
  modal(
    "Bulk edit cards",
    `<p>Replace one value in terms or definitions. This preserves card IDs and resets only affected mastery through content revisions.</p><div class="form-grid">${selectField(
      "Field",
      "key",
      [
        ["term", "Term"],
        ["definition", "Definition"],
      ],
      "term",
    )}${field("Find", "find", "", "text", "required")}${field("Replace with", "replace")}${check("Only starred cards", "starred")}</div>`,
    true,
    async (fd) => {
      const find = String(fd.get("find"));
      if (!find) throw new Error("Enter the text to replace.");
      await store.change(
        "Bulk edit cards",
        (rows) =>
          rows.map((c) =>
            c.type === "card" &&
            !c.deleted &&
            c.setId === sid &&
            (!fd.has("starred") || c.starred)
              ? updateFlashcard(c, {
                  [fd.get("key")]: c[fd.get("key")]
                    .split(find)
                    .join(fd.get("replace")),
                })
              : c,
          ),
        { scope: cardScope(sid) },
      );
      render();
    },
  );
}
function trash() {
  const deleted = store.records.filter(
    (r) =>
      r.deleted &&
      !r.erased &&
      ["set", "folder", "card", "transcript"].includes(r.type),
  );
  modal(
    "Recently Deleted",
    `<p>Deleted content stays here until you explicitly erase it. Study history is retained.</p><div class="stack">${deleted.map((r) => `<div class="row between"><span>${esc(r.title || r.name || r.term || r.id)} <small>(${esc(r.type)}${r.type === "transcript" && r.audioId ? " with recording" : ""})</small></span>${button("Restore", "restore-record", `data-id="${attr(r.id)}"`, "small")}${button("Permanently erase", "erase-record", `data-id="${attr(r.id)}"`, "small danger")}</div>`).join("") || '<p class="muted">Nothing deleted.</p>'}</div>`,
    false,
  );
}
function statistics() {
  const pool = getEligibleCards(store.records, {
      setIds: statsSet ? [statsSet] : [],
      folderId: statsFolder || null,
      subject: statsSubject,
    }),
    ids = new Set(pool.map((c) => c.id));
  const inDate = (at) =>
    (!statsFrom || at >= statsFrom) && (!statsTo || at.slice(0, 10) <= statsTo);
  const attempts = store
      .list("attempt")
      .filter((a) => ids.has(a.cardId) && inDate(a.at)),
    tests = store
      .list("test")
      .filter(
        (t) =>
          t.submittedAt &&
          inDate(t.submittedAt) &&
          t.questions.some((q) => ids.has(q.cardId)),
      ),
    session = store
      .list("session")
      .filter(
        (s) => s.cardIds.some((cid) => ids.has(cid)) && inDate(s.startedAt),
      );
  const correct = attempts.filter((a) => a.effectiveCorrect).length,
    testResults = tests.flatMap((t) =>
      t.results.filter((r) => ids.has(r.cardId)),
    ),
    missed = new Map();
  for (const a of [
    ...attempts.filter((a) => !a.effectiveCorrect),
    ...testResults.filter((a) => !a.effectiveCorrect),
  ])
    missed.set(a.cardId, (missed.get(a.cardId) || 0) + 1);
  const notStudied = getEligibleCards(store.records, {
    setIds: statsSet ? [statsSet] : [],
    folderId: statsFolder || null,
    subject: statsSubject,
    filter: "notStudied",
  }).length;
  const learning = getEligibleCards(store.records, {
    setIds: statsSet ? [statsSet] : [],
    folderId: statsFolder || null,
    subject: statsSubject,
    filter: "learning",
  }).length;
  const mastery = getEligibleCards(store.records, {
    setIds: statsSet ? [statsSet] : [],
    folderId: statsFolder || null,
    subject: statsSubject,
    filter: "mastered",
  }).length;
  return (
    head(
      "Study Statistics",
      "A clear view of what you’ve practiced, recalled, and tested.",
    ) +
    `<div class="toolbar"><select id="statsSet" aria-label="Set">${options([["", "All sets"], ...store.list("set").map((s) => [s.id, s.title])], statsSet)}</select><select id="statsFolder" aria-label="Folder">${options([["", "All folders"], ...folderOptions().slice(1)], statsFolder)}</select><select id="statsSubject" aria-label="Subject">${options(
      [
        ["", "All subjects"],
        ...[
          ...new Set(
            store
              .list("set")
              .map((s) => s.subject)
              .filter(Boolean),
          ),
        ].map((s) => [s, s]),
      ],
      statsSubject,
    )}</select><label>From<input type="date" id="statsFrom" value="${attr(statsFrom)}"></label><label>To<input type="date" id="statsTo" value="${attr(statsTo)}"></label></div><div class="metrics">${metric(pool.length, "Eligible terms")}${metric(pool.filter((c) => c.starred).length, "Starred terms")}${metric(mastery, "Learn mastered → definition")}${metric(attempts.length ? Math.round((correct / attempts.length) * 100) + "%" : "—", "Learn accuracy")}</div><div class="metrics">${metric(new Set(pool.map((c) => c.setId)).size, "Sets in this selection")}${metric(learning, "Still learning → definition")}${metric(notStudied, "Not studied → definition")}${metric(testResults.length ? Math.round((testResults.filter((r) => r.effectiveCorrect).length / testResults.length) * 100) + "%" : "—", "Test accuracy")}</div><div class="two-col"><div class="panel"><h2>Test performance</h2><p>${testResults.length ? Math.round((testResults.filter((r) => r.effectiveCorrect).length / testResults.length) * 100) + "% across " + testResults.length + " questions" : "No test results in this range."}</p><div class="table-wrap"><table><thead><tr><th>Date / set</th><th>Score</th><th>Time</th><th></th></tr></thead><tbody>${tests
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
      .map(
        (t) =>
          `<tr><td>${date(t.submittedAt)}<small style="display:block">${esc(t.setIds.map((sid) => store.get(sid)?.title || "Deleted set").join(", "))}</small><small>${esc(
            Object.entries(
              t.questions.reduce(
                (a, q) => ((a[q.type] = (a[q.type] || 0) + 1), a),
                {},
              ),
            )
              .map(([k, n]) => k + ": " + n)
              .join(" · "),
          )}</small></td><td>${t.results.filter((r) => r.effectiveCorrect).length}/${t.questions.length}</td><td>${duration(t.durationMs)}</td><td>${button("Review", "review-test", `data-id="${attr(t.id)}"`, "small")}</td></tr>`,
      )
      .join(
        "",
      )}</tbody></table></div><p class="muted" style="margin-top:15px">Each row is a saved attempt, so repeated tests can be compared without replacing earlier results.</p></div><div class="panel"><h2>Terms to revisit</h2>${
      [...missed]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(
          ([cid, n]) =>
            `<div class="row between" style="padding:9px 0"><a href="#set/${attr(store.get(cid)?.setId)}/${attr(cid)}">${esc(store.get(cid)?.term || "Deleted term")}</a><small>${n} missed</small></div>`,
        )
        .join("") || '<p class="muted">No mistakes recorded in this range.</p>'
    }<hr><h3>Review and study time</h3><p>${duration(session.reduce((sum, s) => sum + (s.activeMs ?? Math.max(0, Date.parse(s.finishedAt || s.updatedAt) - Date.parse(s.startedAt))), 0))} elapsed across ${session.length} sessions</p><p class="muted">${session.reduce((n, s) => n + Object.values(s.assessments || {}).filter((v) => v === "know").length, 0)} cards self-assessed as Know. Self-assessment is separate from Learn mastery and Test scores.</p></div></div><div class="section-line"><h2>Recent study sessions</h2></div><div class="panel">${
      session
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, 20)
        .map(
          (s) =>
            `<div class="row between" style="padding:10px 0"><span>${esc(s.mode)} · ${date(s.startedAt)} · ${s.cardIds.length} terms</span><small>${s.finishedAt ? "Finished" : "In progress"}</small></div>`,
        )
        .join("") ||
      '<p class="muted">Your sessions will appear after you study.</p>'
    }</div>`
  );
}
function syncView() {
  return (
    head(
      "Google Drive",
      "Optional sync for your saved study materials.",
      button("Save now", "sync-now", "", "primary"),
    ) +
    `<div class="settings-section stack"><section class="panel stack"><h2>Study library sync</h2><p class="cloud-status">${esc(sync.state)}</p>${sync.error ? `<div class="notice error">${esc(sync.error)}</div>` : ""}<p class="muted">Sync sets, progress, tests, and transcript text. Audio stays on this device.</p><form id="driveSettings" class="stack">${field("Google OAuth client ID", "clientId", auth.clientId, "text", 'autocomplete="off"')}<div class="row"><button type="submit">Save client ID</button>${button(sync.enabled ? "Reconnect Google Drive" : "Connect Google Drive", "connect-drive", "", "primary")}${sync.enabled ? button("Disable autosync", "disable-sync") : ""}</div></form><details><summary>Set up Google Drive</summary><p>Enable the Google Drive API in your Google Cloud project, create a Web application OAuth client, and add this exact origin: <code>${esc(location.origin)}</code>. Access uses the drive.file scope. Access tokens live only in this tab’s memory; reconnect after refreshing.</p></details></section>${
      sync.conflicts.length
        ? `<section class="panel stack"><h2>Review conflicting changes</h2><p>Both versions are retained until you choose. Download a backup before resolving.</p><form id="conflictForm">${sync.conflicts
            .map(
              (c, i) =>
                `<div class="notice"><strong>${esc(c.local.type)} · ${esc(c.local.title || c.local.term || c.id)}</strong><div class="form-grid"><pre>${esc(JSON.stringify(c.local, null, 2))}</pre><pre>${esc(JSON.stringify(c.remote, null, 2))}</pre></div>${selectField(
                  "Keep",
                  "conflict-" + i,
                  [
                    ["local", "This device"],
                    ["remote", "Drive version"],
                  ],
                  "local",
                )}</div>`,
            )
            .join(
              "",
            )}<button class="primary" type="submit">Resolve and synchronize</button></form></section>`
        : ""
    }<section class="panel"><h2>Backup and restore</h2><p class="muted">Portable backups contain saved study records and transcript text. Local audio and downloaded models are separate.</p><div class="row">${button("Download study backup", "backup")}${button("Restore study backup", "restore-backup")}</div></section></div>`
  );
}
async function settings() {
  const usage = await store.audioUsage();
  const theme = localStorage.getItem("studyPlatform.theme") || "system";
  return (
    head("Settings") +
    `<div class="settings-section stack"><form id="settingsForm" class="panel stack"><h2>Appearance</h2><p class="muted">Choose a theme, or follow your device automatically.</p>${selectField(
      "Theme",
      "theme",
      [
        ["system", "System"],
        ["light", "Light"],
        ["dark", "Dark"],
      ],
      theme,
    )}<button type="submit" class="primary">Save appearance</button></form><section class="panel"><h2>Google Drive</h2><p class="muted">${esc(sync.state)} · Optional synchronization for saved materials.</p><a class="button" href="#sync">Manage sync →</a></section><section class="panel"><details class="model-settings"><summary>Downloaded models</summary>${await transcripts.modelView()}</details></section><section class="panel stack"><h2>Your device storage</h2><p>${usage.count} recordings · ${(usage.bytes / 1024 / 1024).toFixed(1)} MB</p><p class="muted">Keep a portable backup before clearing browser data. Recordings are never uploaded by sync.</p><div class="row">${button("Keep storage on this device", "persist-storage")}${button("Download backup", "backup")}${button("Recently deleted", "trash")}${button("Download migration backup", "migration-backup")}</div><details><summary>Recover an earlier version</summary><p>The first study-only launch saves all prior study records and local preferences in a local migration backup. Download it before rolling back source through Git. It is retained separately from Google Drive sync.</p>${button("Restore pre-redesign study records…", "migration-restore", "", "danger")}</details></section><section class="panel"><h2>Learning progress</h2><p class="muted">Mastery is separate from stars, self-assessment, and your saved test history.</p>${button("Reset Learn progress…", "reset-progress", "", "danger")}</section><section class="panel"><h2>Statistics</h2><p class="muted">The Statistics page and your study streak are built from your answer history, saved test results and finished study sessions. Resetting erases that history. Sets, cards, stars and unfinished sessions stay.</p>${button("Reset statistics…", "reset-stats", "", "danger")}</section></div>`
  );
}
function applyTheme() {
  const theme = localStorage.getItem("studyPlatform.theme") || "system";
  document.documentElement.dataset.theme =
    theme === "system"
      ? matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;
}
applyTheme();
matchMedia("(prefers-color-scheme: dark)").addEventListener(
  "change",
  applyTheme,
);
let renderVersion = 0;
// Every screen has a Back button that goes to the screen it belongs to.
function updateBack(parts) {
  const button = $("#backButton"),
    to = (hash, name) => ({ hash, name });
  let target = null;
  const inFolder = (fid) =>
    fid && store.get(fid)
      ? to("folder/" + fid, folderPath(fid))
      : to("library", "Study Library");
  if (route === "library") target = to("dashboard", "Dashboard");
  else if (route === "folder") target = inFolder(store.get(folderId)?.parentId);
  else if (route === "set") target = inFolder(store.get(setId)?.folderId);
  else if (route === "study" || route === "test") {
    const ids = store.get(parts[1])?.setIds || [];
    target =
      ids.length === 1 && store.get(ids[0])
        ? to("set/" + ids[0], store.get(ids[0]).title)
        : to("library", "Study Library");
  } else if (route === "transcripts")
    target = parts[1]
      ? to("transcripts", "Transcripts")
      : to("dashboard", "Dashboard");
  else if (["statistics", "settings"].includes(route))
    target = to("dashboard", "Dashboard");
  else if (route === "sync") target = to("settings", "Settings");
  button.hidden = !target;
  if (target) {
    button.textContent = "← " + target.name;
    button.setAttribute("aria-label", "Back to " + target.name);
    button.dataset.back = target.hash;
  }
}
async function render() {
  const version = ++renderVersion;
  const parts = location.hash.slice(1).split("/");
  route = parts[0] || "dashboard";
  folderId = route === "folder" ? parts[1] : null;
  setId = route === "set" ? parts[1] : setId;
  document
    .querySelectorAll("[data-nav]")
    .forEach((a) =>
      a.classList.toggle(
        "active",
        a.dataset.nav ===
          (["set", "folder", "study", "test"].includes(route)
            ? "library"
            : route),
      ),
    );
  $("#breadcrumb").textContent =
    {
      dashboard: "Your dashboard",
      library: "Study Library",
      folder: folderPath(folderId),
      set: "Study Library / " + (store.get(setId)?.title || "Set"),
      study: "Study session",
      test: "Practice test",
      transcripts: "Class Transcriptions",
      statistics: "Study Statistics",
      settings: "Settings",
      sync: "Google Drive",
    }[route] || "Studyroom";
  updateBack(parts);
  let html;
  if (!["study", "test"].includes(route)) await study.leave();
  if (route === "dashboard") html = dashboard();
  else if (["library", "folder"].includes(route)) html = library.view(folderId);
  else if (route === "set") {
    if (parts[2]) {
      cardQuery = "";
      const index = cardsFor(setId).findIndex((c) => c.id === parts[2]);
      if (index >= 0) cardPage = Math.floor(index / 40);
    }
    html = setView();
  } else if (route === "study" || route === "test")
    html = await study.view(parts[1]);
  else if (route === "transcripts") html = await transcripts.view(parts[1]);
  else if (route === "statistics") html = statistics();
  else if (route === "sync") html = syncView();
  else if (route === "settings") html = await settings();
  else html = dashboard();
  if (version !== renderVersion) return;
  $("#view").innerHTML = html;
  bindView();
  library.bind();
  study.bind();
  transcripts.bind();
  if (route === "set" && parts[2]) {
    const card = $("#card-" + CSS.escape(parts[2]));
    if (card) {
      card.classList.add("focus-term");
      card.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }
}
function bindView() {
  document.querySelectorAll("[data-card-field]").forEach((el) => {
    el.cardBase = clone(store.get(el.dataset.id)?.[el.dataset.cardField]);
    el.oninput = () => queueCardEdit(el);
  });
  for (const key of ["Set", "Folder", "Subject", "From", "To"]) {
    const el = $("#stats" + key);
    if (el)
      el.onchange = () => {
        if (key === "Set") statsSet = el.value;
        if (key === "Folder") statsFolder = el.value;
        if (key === "Subject") statsSubject = el.value;
        if (key === "From") statsFrom = el.value;
        if (key === "To") statsTo = el.value;
        render();
      };
  }
  const form = $("#settingsForm");
  if (form)
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      localStorage.setItem("studyPlatform.theme", fd.get("theme"));
      applyTheme();
      await store.put(
        {
          ...record("preferences"),
          ...store.get("study-preferences"),
          id: "study-preferences",
          appearance: { theme: fd.get("theme") },
        },
        { undo: false },
      );
      toast("Settings saved.");
    };
  const driveForm = $("#driveSettings");
  if (driveForm)
    driveForm.onsubmit = (e) => {
      e.preventDefault();
      try {
        auth.configure(new FormData(driveForm).get("clientId"));
        toast("Client ID saved. Connect Google Drive to authorize.");
      } catch (error) {
        toast(error.message);
      }
    };
  const cf = $("#conflictForm");
  if (cf)
    cf.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(cf);
      try {
        await sync.resolveAll(
          sync.conflicts.map((_, i) => fd.get("conflict-" + i)),
        );
        render();
      } catch (err) {
        toast(err.message);
      }
    };
}
let searchTimer;
function debouncedRender(focusId) {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const pos = $("#" + focusId)?.selectionStart;
    await render();
    const el = $("#" + focusId);
    el?.focus();
    if (el && pos != null) el.setSelectionRange(pos, pos);
  }, 180);
}
const draftTab = sessionStorage.getItem("studyPlatform.draftTab") || id();
sessionStorage.setItem("studyPlatform.draftTab", draftTab);
const draftKey = "studyPlatform.cardDraft." + draftTab;
const pendingEdits = new Map(),
  editBases = new Map();
let editTimer;
const journal = () => {
  const saved = new Map(JSON.parse(localStorage.getItem(draftKey) || "[]"));
  for (const [cid, patch] of pendingEdits)
    saved.set(cid, { ...saved.get(cid), ...patch });
  localStorage.setItem(draftKey, JSON.stringify([...saved]));
};
function queueCardEdit(el) {
  const value = ["acceptedAnswers", "termAnswers", "tags"].includes(
    el.dataset.cardField,
  )
    ? el.value
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
    : el.value;
  pendingEdits.set(el.dataset.id, {
    ...pendingEdits.get(el.dataset.id),
    [el.dataset.cardField]: value,
  });
  const base = editBases.get(el.dataset.id) || {};
  if (!Object.hasOwn(base, el.dataset.cardField))
    base[el.dataset.cardField] = clone(el.cardBase);
  editBases.set(el.dataset.id, base);
  journal();
  clearTimeout(editTimer);
  editTimer = setTimeout(flushEdits, 200);
}
let flushing = Promise.resolve();
async function flushEdits() {
  clearTimeout(editTimer);
  if (!pendingEdits.size) return flushing;
  const edits = new Map(pendingEdits),
    bases = new Map([...editBases].map(([key, value]) => [key, clone(value)]));
  pendingEdits.clear();
  editBases.clear();
  const editedSet = setId;
  flushing = flushing
    .then(() =>
      store.change(
        "Edit cards",
        (rows) =>
          rows.map((c) => {
            const patch = edits.get(c.id);
            if (!patch) return c;
            for (const [key, value] of Object.entries(patch)) {
              const base = bases.get(c.id)?.[key];
              if (
                JSON.stringify(c[key]) !== JSON.stringify(base) &&
                JSON.stringify(c[key]) !== JSON.stringify(value)
              )
                throw new Error(
                  "This field changed in another tab or device. Your draft is preserved; reopen the card and review it before saving.",
                );
            }
            return updateFlashcard(c, patch);
          }),
        { scope: cardScope(editedSet) },
      ),
    )
    .then(() => {
      for (const [cid, patch] of edits)
        for (const [key, value] of Object.entries(patch)) {
          document.querySelectorAll("[data-card-field]").forEach((el) => {
            if (el.dataset.id === cid && el.dataset.cardField === key)
              el.cardBase = clone(value);
          });
          const queued = editBases.get(cid);
          if (
            queued &&
            JSON.stringify(queued[key]) ===
              JSON.stringify(bases.get(cid)?.[key])
          )
            queued[key] = clone(value);
        }
      syncUndo();
      const savedJournal = new Map(
        JSON.parse(localStorage.getItem(draftKey) || "[]"),
      );
      for (const [cid, patch] of edits) {
        const latest = savedJournal.get(cid) || {};
        for (const [key, value] of Object.entries(patch))
          if (JSON.stringify(latest[key]) === JSON.stringify(value))
            delete latest[key];
        if (Object.keys(latest).length) savedJournal.set(cid, latest);
        else savedJournal.delete(cid);
      }
      if (savedJournal.size)
        localStorage.setItem(draftKey, JSON.stringify([...savedJournal]));
      else localStorage.removeItem(draftKey);
    })
    .catch((e) => {
      toast("Save failed: " + e.message);
      for (const [k, v] of edits) {
        pendingEdits.set(k, { ...v, ...pendingEdits.get(k) });
        editBases.set(k, { ...bases.get(k), ...editBases.get(k) });
      }
    });
  return flushing;
}
window.addEventListener("pagehide", () => flushEdits());
document.addEventListener("visibilitychange", () => {
  if (document.hidden) flushEdits();
});
window.addEventListener("beforeunload", (e) => {
  if (pendingEdits.size) {
    flushEdits();
    e.preventDefault();
    e.returnValue = "";
  }
});

document.addEventListener("click", (e) => {
  const back = e.target.closest("#backButton");
  if (back?.dataset.back) go(back.dataset.back);
});
document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || el.disabled) return;
  const action = el.dataset.action;
  try {
    await flushEdits();
    if (action === "star") {
      study.pauseAuto();
      await store.update(
        el.dataset.id,
        (c) => ({ ...c, starred: !c.starred }),
        {
          label: "Toggle star",
          scope: route === "set" ? cardScope(setId) : null,
        },
      );
      await render();
      return;
    }
    if (action === "migration-backup") {
      const backup = await store.meta("beforeStudyOnlyMigration");
      if (backup)
        download(
          "studyroom-migration-backup.json",
          JSON.stringify(backup, null, 2),
        );
      else toast("No migration backup is available.");
      return;
    }
    if (action === "migration-restore") {
      confirmAction(
        "Restore pre-redesign study records?",
        "The backup will be merged with your current library. Newer and conflicting changes are preserved for review.",
        async () => {
          const backup = await store.meta("beforeStudyOnlyMigration");
          if (!backup) throw new Error("Migration backup unavailable.");
          const conflicts = await store.restore(backup.study);
          if (conflicts.length) {
            sync.conflicts = conflicts;
            go("sync");
          } else toast("Earlier records merged.");
        },
        "Restore records",
      );
      return;
    }
    if (await library.handle(action, el)) return;
    if (await study.handle(action, el)) return;
    if (await transcripts.handle(action, el)) return;
    if (action === "new-set") editSet();
    else if (action === "set-details") editSet(el.dataset.id);
    else if (action === "new-folder") editFolder();
    else if (action === "edit-folder") editFolder(el.dataset.id);
    else if (action === "delete-folder") deleteFolder(el.dataset.id);
    else if (action === "pin") {
      await store.update(el.dataset.id, (s) => ({ ...s, pinned: !s.pinned }));
      render();
    } else if (action === "toggle-edit") {
      editing = !editing;
      render();
    } else if (action === "edit-card") {
      editing = true;
      go("set/" + store.get(el.dataset.id).setId + "/" + el.dataset.id);
    } else if (action === "add-card") {
      const sid = el.dataset.id;
      await store.put(createFlashcard(sid, {}, cardsFor(sid).length), {
        scope: cardScope(sid),
      });
      editing = true;
      cardPage = Math.floor((cardsFor(sid).length - 1) / 40);
      render();
    } else if (action === "duplicate-card") {
      const c = store.get(el.dataset.id);
      await store.put(
        createFlashcard(
          c.setId,
          {
            ...c,
            id: id(),
            clock: {},
            revisions: [],
            createdAt: now(),
            updatedAt: now(),
          },
          cardsFor(c.setId).length,
        ),
        { scope: cardScope(c.setId) },
      );
      render();
    } else if (action === "move-card") {
      const c = store.get(el.dataset.id),
        cards = cardsFor(c.setId),
        from = cards.findIndex((v) => v.id === c.id),
        to = from + Number(el.dataset.step);
      if (to < 0 || to >= cards.length) return;
      [cards[from], cards[to]] = [cards[to], cards[from]];
      const order = new Map(cards.map((c, i) => [c.id, i]));
      await store.change(
        "Reorder cards",
        (rows) =>
          rows.map((c) =>
            order.has(c.id) ? { ...c, order: order.get(c.id) } : c,
          ),
        { scope: cardScope(c.setId) },
      );
      render();
    } else if (action === "delete-card")
      confirmAction(
        "Delete card?",
        "The card moves to Recently Deleted. Its test history is preserved.",
        async () => {
          const card = store.get(el.dataset.id);
          await store.update(
            el.dataset.id,
            (r) => ({ ...r, deleted: true, deletedAt: now() }),
            { label: "Delete card", scope: cardScope(card.setId) },
          );
          render();
        },
        "Delete card",
      );
    else if (action === "duplicate-set") {
      const original = store.get(el.dataset.id),
        set = createStudySet({
          ...original,
          id: id(),
          clock: {},
          title: original.title + " (copy)",
          createdAt: now(),
          updatedAt: now(),
          lastStudiedAt: null,
        });
      const cards = cardsFor(original.id).map((c, i) =>
        createFlashcard(
          set.id,
          {
            ...c,
            id: id(),
            setId: set.id,
            clock: {},
            revisions: [],
            createdAt: now(),
            updatedAt: now(),
          },
          i,
        ),
      );
      await store.putMany([set, ...cards]);
      go("set/" + set.id);
    } else if (action === "delete-set")
      confirmAction(
        "Delete this set?",
        "The set and its cards move to Recently Deleted. Test attempts and learning history are retained.",
        async () => {
          await store.change("Delete set", (rows) =>
            rows.map((r) =>
              !r.deleted &&
              (r.id === el.dataset.id ||
                (r.type === "card" && r.setId === el.dataset.id))
                ? {
                    ...r,
                    deleted: true,
                    deletedAt: now(),
                    deletedWith: el.dataset.id,
                  }
                : r,
            ),
          );
          go("library");
        },
        "Delete set",
      );
    else if (action === "import-set") importCards();
    else if (action === "import-cards") importCards(el.dataset.id);
    else if (action === "export-set") exportSet(el.dataset.id);
    else if (action === "bulk-edit") bulkEdit(el.dataset.id);
    else if (action === "configure") {
      const { selected } = library.state,
        setIds = el.dataset.sets
          ? el.dataset.sets.split(",")
          : selected.size
            ? [...selected]
            : library.librarySets().map((s) => s.id);
      study.configure(
        el.dataset.mode,
        setIds,
        el.dataset.filter ? { filter: el.dataset.filter } : {},
      );
    } else if (action === "card-prev") {
      cardPage = Math.max(0, cardPage - 1);
      render();
    } else if (action === "card-next") {
      cardPage++;
      render();
    } else if (action === "undo-card") {
      const scope = cardScope(setId);
      if (!store.canUndo(scope)) {
        toast("There is no card change to undo.");
        return;
      }
      const label = store.undo.at(-1).label;
      await store.undoLast(scope);
      render();
      toast(`Undid: ${label}.`);
    } else if (action === "trash") trash();
    else if (action === "restore-record") {
      const r = store.records.find((r) => r.id === el.dataset.id);
      await store.change("Restore deleted item", (rows) => {
        const restored = new Set(
          rows
            .filter((v) => v.id === r.id || v.deletedWith === r.id)
            .map((v) => v.id),
        );
        const available = (key) =>
          !key ||
          restored.has(key) ||
          rows.some((v) => v.id === key && !v.deleted);
        if (r.type === "card" && !available(r.setId))
          throw new Error("Restore this card’s set before restoring the card.");
        return rows.map((v) =>
          restored.has(v.id)
            ? {
                ...v,
                deleted: false,
                deletedAt: null,
                deletedWith: null,
                ...(v.type === "folder" && !available(v.parentId)
                  ? { parentId: null }
                  : v.type === "set" && !available(v.folderId)
                    ? { folderId: null }
                    : {}),
              }
            : v,
        );
      });
      trash();
      render();
    } else if (action === "erase-record")
      confirmAction(
        "Permanently erase content?",
        "Text will be erased from this record (a transcript's recording is deleted from this device too). A deletion marker remains to prevent old devices from restoring it. Historical test snapshots are retained.",
        async () => {
          // A transcript's recording is erased with it.
          const doomed = store.records.find((r) => r.id === el.dataset.id);
          if (doomed?.type === "transcript" && doomed.audioId)
            await store.deleteAudio(doomed.audioId);
          await store.update(
            el.dataset.id,
            (r) => ({
              id: r.id,
              type: r.type,
              clock: r.clock,
              createdAt: r.createdAt,
              deleted: true,
              erased: true,
              deletedAt: now(),
              ...(r.type === "set"
                ? { title: "Erased set" }
                : r.type === "card"
                  ? { setId: r.setId, term: "", definition: "" }
                  : r.type === "folder"
                    ? { name: "Erased folder", parentId: null }
                    : { title: "Erased transcript" }),
            }),
            { undo: false },
          );
          trash();
        },
        "Erase permanently",
      );
    else if (action === "backup")
      download(
        "study-platform-backup.json",
        JSON.stringify(makeBackup(store.records), null, 2),
      );
    else if (action === "restore-backup") {
      const d = modal(
        "Restore study backup",
        '<p>Backup records are validated and merged. Existing records are preserved. Conflicting content requires review.</p><input type="file" name="file" accept=".json" required>',
        true,
        async (fd) => {
          const file = fd.get("file");
          const backup = validateBackup(JSON.parse(await file.text()));
          const conflicts = await store.restore(backup);
          if (conflicts.length) {
            sync.conflicts = conflicts;
            go("sync");
            toast("Conflicting records need review.");
          } else {
            render();
            toast("Backup merged successfully.");
          }
        },
        { submitLabel: "Validate and restore" },
      );
    } else if (action === "sync-now") {
      await sync.sync();
      render();
    } else if (action === "connect-drive") {
      await sync.connect();
      render();
    } else if (action === "disable-sync") {
      sync.enabled = false;
      await store.meta("driveEnabled", false);
      clearTimeout(sync.timer);
      sync.status("SAVED LOCALLY");
      render();
    } else if (action === "persist-storage") {
      const ok = await navigator.storage?.persist?.();
      toast(
        ok
          ? "Browser storage persistence granted."
          : "Browser did not grant persistence. Keep a backup.",
      );
    } else if (action === "reset-progress")
      confirmAction(
        "Reset all Learn progress?",
        "This resets demonstrated mastery in both directions. Cards, stars, attempts, and historical tests are preserved.",
        async () => {
          await store.change("Reset learning progress", (rows) =>
            resetLearning(rows, () => true),
          );
          study.forget();
          toast("Learn progress reset.");
        },
        "Reset mastery",
      );
    else if (action === "reset-stats") resetStatistics();
    else if (action === "reset-set-progress") {
      const set = store.get(el.dataset.id),
        terms = cardsFor(set.id).length;
      confirmAction(
        `Reset Learn progress for “${set.title}”?`,
        `This sets mastery back to “not studied” for the ${terms} ${terms === 1 ? "term" : "terms"} in this set, in both directions, and in any unfinished Learn session that includes it. Other sets, the cards, stars, answer history, saved tests and flashcard progress are not changed.`,
        async () => {
          await store.change(`Reset Learn progress: ${set.title}`, (rows) =>
            resetLearning(rows, (r) => r.setId === set.id),
          );
          study.forget();
          render();
          toast(`Learn progress reset for “${set.title}”.`);
        },
        "Reset this set’s progress",
      );
    }
  } catch (error) {
    toast(error.message);
    console.error(error);
  }
});
sync.addEventListener("status", () => {
  $("#sidebarSync").textContent = sync.state;
});
store.addEventListener("change", (e) => {
  if (e.detail?.external) {
    toast("Library updated from another tab.");
    if (!pendingEdits.size && !editing) render();
  }
  if (!sync.enabled) $("#sidebarSync").textContent = "Saved on this device";
});
window.addEventListener("unhandledrejection", (event) => {
  toast("Something could not finish: " + event.reason?.message);
});
if ("serviceWorker" in navigator)
  navigator.serviceWorker
    .register("./sw.js")
    .catch((e) => console.warn("Offline cache unavailable:", e.message));
setInterval(() => {
  if (sync.enabled && navigator.onLine && !sync.running)
    sync.sync().catch(() => {});
}, 60000);
// Whenever the site opens with Drive sync on, sign in again automatically and sync.
if (sync.enabled && auth.clientId)
  sync
    .sync()
    .then(() => render())
    .catch(() => {});
await transcripts.prepare();
await render();
$("#sidebarSync").textContent = sync.state;

const recoveredKeys = Object.keys(localStorage).filter((k) =>
  k.startsWith("studyPlatform.cardDraft."),
);
if (recoveredKeys.length) {
  const drafts = recoveredKeys.flatMap((k) => {
    try {
      return JSON.parse(localStorage.getItem(k)) || [];
    } catch {
      return [];
    }
  });
  if (drafts.length)
    modal(
      "Recover unsaved card drafts",
      `<p>These edits were saved before the last page closed. Review them before applying them to the current library.</p><div class="stack">${drafts.map(([cid, patch]) => `<div class="notice"><strong>${esc(store.get(cid)?.term || "Removed card")}</strong><pre style="white-space:pre-wrap">${esc(JSON.stringify(patch, null, 2))}</pre></div>`).join("")}</div>`,
      true,
      async () => {
        await store.change("Recover card drafts", (rows) =>
          rows.map((c) => {
            const patches = drafts
              .filter(([cid]) => cid === c.id)
              .map(([, patch]) => patch);
            return patches.length
              ? updateFlashcard(c, Object.assign({}, ...patches))
              : c;
          }),
        );
        for (const k of recoveredKeys) localStorage.removeItem(k);
        render();
      },
      { submitLabel: "Apply recovered drafts" },
    );
}
