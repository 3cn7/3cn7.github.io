// Study Library: a file-manager style view of folders and sets.
// - Grid view: breadcrumb, folder cards and set tiles.
// - Folder tree view: an expandable tree (WAI-ARIA tree pattern) of folders and sets.
// - Sets and folders can be dragged onto folders, breadcrumbs and tree rows. Every drag has a
//   non-drag equivalent ("Move to…" on each item and for the selection) that works with one click
//   or keyboard activation, so nothing depends on drag-and-drop.
import {
  descendantFolders,
  validateFolderMove,
  getEligibleCards,
  normalize,
} from "./core.js";
import { learnComplete } from "./engine.js";
import {
  $,
  esc,
  attr,
  date,
  button,
  star,
  toast,
  modal,
  selectField,
  options,
  empty,
} from "./ui.js";
const VIEW_KEY = "studyPlatform.libraryView",
  OPEN_KEY = "studyPlatform.libraryTreeOpen",
  NESTED_KEY = "studyPlatform.libraryNested";
const pref = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const setPref = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {}
};
export function createLibraryUI(ctx) {
  const { store } = ctx;
  let storedOpen = null;
  try {
    storedOpen = JSON.parse(pref(OPEN_KEY));
  } catch {}
  const state = {
    query: "",
    sort: "modified",
    subject: "",
    starred: false,
    // Like a file manager, a folder shows what is directly inside it; this opts in to everything below.
    nested: pref(NESTED_KEY) === "1",
    selected: new Set(),
    view: pref(VIEW_KEY) === "tree" ? "tree" : "grid",
    open: new Set(Array.isArray(storedOpen) ? storedOpen : []),
    // Until the learner collapses something, the tree starts fully expanded.
    openAll: !Array.isArray(storedOpen),
    current: null,
    folderId: null,
  };
  let drag = null,
    hoverTimer = null,
    typeahead = { text: "", at: 0 };

  /* ---------- data helpers (shared with the rest of the app) ---------- */
  const cardsFor = (sid) =>
    store
      .list("card")
      .filter((c) => c.setId === sid)
      .sort((a, b) => a.order - b.order);
  function folderPath(fid) {
    const names = [],
      seen = new Set();
    while (fid && !seen.has(fid)) {
      seen.add(fid);
      const f = store.get(fid);
      if (!f) break;
      names.unshift(f.name);
      fid = f.parentId;
    }
    return names.join(" / ") || "Unfiled";
  }
  const folderOptions = (exclude = null) => [
    ["", "Unfiled / root"],
    ...store
      .list("folder")
      .filter((f) => !exclude || !exclude.has(f.id))
      .sort((a, b) => folderPath(a.id).localeCompare(folderPath(b.id)))
      .map((f) => [f.id, folderPath(f.id)]),
  ];
  function counts(sid) {
    const cards = cardsFor(sid),
      eligible = getEligibleCards(store.records, { setIds: [sid] }),
      mastered = getEligibleCards(store.records, {
        setIds: [sid],
        filter: "mastered",
      }).length;
    return {
      cards,
      modifiedAt: cards.reduce(
        (latest, c) => (c.updatedAt > latest ? c.updatedAt : latest),
        store.get(sid)?.updatedAt || "",
      ),
      terms: cards.length,
      starred: cards.filter((c) => c.starred).length,
      mastered,
      percent: eligible.length ? (mastered / eligible.length) * 100 : 0,
    };
  }
  const filtering = () =>
    !!(normalize(state.query) || state.subject || state.starred);
  // A set whose folder no longer exists counts as unfiled.
  const folderOf = (s) =>
    s.folderId && store.get(s.folderId) ? s.folderId : "";
  function librarySets(folderId = state.folderId) {
    // Searching and filtering look through everything below the current folder.
    const deep = state.nested || filtering();
    const folders = folderId
      ? deep
        ? descendantFolders(store.records, folderId)
        : new Set([folderId])
      : deep
        ? null
        : new Set([""]);
    const q = normalize(state.query);
    const sets = store
      .list("set")
      .filter(
        (s) =>
          (!folders || folders.has(folderOf(s))) &&
          (!state.subject || s.subject === state.subject) &&
          (!state.starred || cardsFor(s.id).some((c) => c.starred)) &&
          (!q ||
            normalize(
              s.title + " " + s.description + " " + folderPath(s.folderId),
            ).includes(q) ||
            cardsFor(s.id).some(
              (c) =>
                (!state.starred || c.starred) &&
                normalize(
                  [
                    c.term,
                    c.definition,
                    ...(c.acceptedAnswers || []),
                    ...(c.termAnswers || []),
                    c.notes,
                    ...(c.tags || []),
                  ].join(" "),
                ).includes(q),
            )),
      );
    const modified = new Map(sets.map((s) => [s.id, s.updatedAt]));
    for (const c of store.list("card"))
      if (modified.has(c.setId) && c.updatedAt > modified.get(c.setId))
        modified.set(c.setId, c.updatedAt);
    return sets.sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        (state.sort === "title"
          ? a.title.localeCompare(b.title)
          : state.sort === "studied"
            ? String(b.lastStudiedAt || "").localeCompare(
                String(a.lastStudiedAt || ""),
              )
            : modified.get(b.id).localeCompare(modified.get(a.id))),
    );
  }
  const folderSummary = (fid) => {
    const ids = descendantFolders(store.records, fid),
      sets = store.list("set").filter((s) => ids.has(s.folderId)),
      terms = store
        .list("card")
        .filter((c) => sets.some((s) => s.id === c.setId)).length;
    return { sets: sets.length, terms };
  };
  const fieldOf = (kind) => (kind === "folder" ? "parentId" : "folderId");
  const nounOf = (kind, n = 1) =>
    ({ set: "set", folder: "folder", transcript: "transcript" })[kind] +
    (n === 1 ? "" : "s");
  const transcriptFolder = (t) =>
    t.folderId && store.get(t.folderId) ? t.folderId : "";
  // Transcripts follow the same scope rules as sets; subject and starred filters do not apply to them.
  function libraryTranscripts(folderId = state.folderId) {
    if (state.subject || state.starred) return [];
    const deep = state.nested || filtering(),
      folders = folderId
        ? deep
          ? descendantFolders(store.records, folderId)
          : new Set([folderId])
        : deep
          ? null
          : new Set([""]),
      q = normalize(state.query);
    return store
      .list("transcript")
      .filter(
        (t) =>
          (!folders || folders.has(transcriptFolder(t))) &&
          (!q || normalize(t.title + " " + (t.rawText || "")).includes(q)),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

  /* ---------- shared markup ---------- */
  // The most recent unfinished Flashcards/Learn session or test that includes this set.
  function unfinishedFor(setId) {
    return [...store.list("session"), ...store.list("test")]
      .filter(
        (s) =>
          s.setIds?.includes(setId) &&
          (s.type === "test"
            ? !s.submittedAt
            : !s.finishedAt && !(s.mode === "learn" && learnComplete(s))),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  }
  function tile(set, selectable = false) {
    const c = counts(set.id),
      picked = state.selected.has(set.id);
    return `<article class="set-tile${picked ? " is-selected" : ""}" data-set-id="${attr(set.id)}"${selectable ? ` draggable="true" data-drag-set="${attr(set.id)}"` : ""}><div class="row between"><span class="row"><span class="tag">${esc(set.subject || "Study set")}</span></span><div class="row">${selectable ? `<label class="check"><input type="checkbox" data-select-set="${attr(set.id)}" ${picked ? "checked" : ""} aria-label="Select ${attr(set.title)}"></label>` : ""}<button class="icon-btn" data-action="pin" data-id="${attr(set.id)}" aria-label="${set.pinned ? "Unpin" : "Pin"} ${attr(set.title)}">${set.pinned ? "📌" : "📍"}</button></div></div><a class="set-title" href="#set/${attr(set.id)}">${esc(set.title)}</a><div class="tile-meta"><span>${c.terms} terms</span><span>★ ${c.starred}</span></div><small class="tile-folder">${esc(folderPath(set.folderId))}</small><div class="progress" role="progressbar" aria-valuenow="${Math.round(c.percent)}" aria-valuemin="0" aria-valuemax="100" aria-label="Learning progress"><div style="width:${c.percent}%"></div></div><div class="tile-meta"><span>${c.mastered} mastered</span><span>Studied ${date(set.lastStudiedAt)}</span></div><div class="row tile-actions">${(() => {
      const u = unfinishedFor(set.id);
      return u
        ? button(
            "▶ Continue where I left off",
            u.type === "test" ? "resume-test" : "resume-session",
            `data-id="${attr(u.id)}"`,
            "primary",
          )
        : "";
    })()}${selectable ? button("➡️ Move", "move-set", `data-id="${attr(set.id)}" aria-label="Move ${attr(set.title)} to a folder…" title="Move to a folder"`, "small") : ""}<details class="context-menu"><summary>Study options</summary><div>${["flashcards", "learn", "test"].map((mode) => button(mode === "flashcards" ? "Flashcards" : mode === "learn" ? "Learn" : "Test", "configure", `data-mode="${mode}" data-sets="${attr(set.id)}"`)).join("")}</div></details></div></article>`;
  }
  function searchResults() {
    const sets = librarySets(),
      cards = getEligibleCards(store.records, {
        setIds: sets.map((s) => s.id),
        query: state.query,
        filter: state.starred ? "starred" : "all",
      }).slice(0, 100);
    return cards.length
      ? `<div class="section-line"><h2>Matching terms</h2><small>Showing up to 100 matches</small></div><div class="panel">${cards.map((c) => `<div class="row between" style="padding:10px 0;border-bottom:1px solid var(--line)"><a href="#set/${attr(c.setId)}/${attr(c.id)}"><strong>${esc(c.term)}</strong><small style="display:block">${esc(c.definition.slice(0, 180))} · ${esc(store.get(c.setId)?.title)}</small></a>${star(c)}</div>`).join("")}</div>`
      : "";
  }
  function breadcrumb(folderId) {
    const trail = [];
    for (let id = folderId, seen = new Set(); id && !seen.has(id); ) {
      seen.add(id);
      const f = store.get(id);
      if (!f) break;
      trail.unshift(f);
      id = f.parentId;
    }
    const crumbs = [
      { id: "", name: "All sets" },
      ...trail.map((f) => ({ id: f.id, name: f.name })),
    ];
    return `<nav class="breadcrumb" aria-label="Folder path"><ol>${crumbs
      .map((c, i) => {
        const last = i === crumbs.length - 1;
        return `<li>${last ? `<span aria-current="page" data-drop-folder="${attr(c.id)}">${esc(c.name)}</span>` : `<a href="${c.id ? "#folder/" + attr(c.id) : "#library"}" data-drop-folder="${attr(c.id)}">${esc(c.name)}</a>`}</li>`;
      })
      .join("")}</ol></nav>`;
  }
  const viewSwitch = () =>
    `<div class="view-switch" role="group" aria-label="Library view">${[
      ["grid", "Grid"],
      ["tree", "Folder tree"],
    ]
      .map(
        ([key, label]) =>
          `<button type="button" data-action="library-view" data-view="${key}" aria-pressed="${state.view === key}" class="${state.view === key ? "active" : ""}">${label}</button>`,
      )
      .join("")}</div>`;

  /* ---------- the page ---------- */
  function view(folderId) {
    state.folderId = folderId;
    const allSubjects = [
      ...new Set(
        store
          .list("set")
          .map((s) => s.subject)
          .filter(Boolean),
      ),
    ];
    const sets = librarySets();
    const header =
      ctx.head(
        folderId ? folderPath(folderId) : "Study Library",
        "",
        button("+ Folder", "new-folder") +
          button("+ New set", "new-set", "", "primary"),
      ) +
      breadcrumb(folderId) +
      `<div class="row library-tools">${viewSwitch()}<label class="folder-jump">Go to folder<select id="folderJump" aria-label="Go to folder">${options(
        folderOptions().map(([id, label]) => [id, id ? label : "All sets"]),
        folderId || "",
      )}</select></label>${folderId ? button("Edit folder", "edit-folder", `data-id="${attr(folderId)}"`, "small") + button("Delete folder", "delete-folder", `data-id="${attr(folderId)}"`, "small danger") : ""}${button("Import set", "import-set", "", "small")}${button("Recently deleted", "trash", "", "small")}${button("Study starred terms", "configure", 'data-mode="learn" data-source="library" data-filter="starred"', "small")}</div><div class="toolbar"><input id="librarySearch" type="search" placeholder="Search sets, folders, terms, and notes…" value="${attr(state.query)}" aria-label="Search study library"><select id="librarySort" aria-label="Sort sets">${options(
        [
          ["modified", "Recently modified"],
          ["studied", "Recently studied"],
          ["title", "Title A–Z"],
        ],
        state.sort,
      )}</select><select id="subjectFilter" aria-label="Filter by subject">${options([["", "All subjects"], ...allSubjects.map((s) => [s, s])], state.subject)}</select><label class="check"><input id="starSearch" type="checkbox" ${state.starred ? "checked" : ""}>Starred only</label>${state.view === "grid" ? `<label class="check"><input id="nestedFolders" type="checkbox" ${state.nested ? "checked" : ""}>Include subfolders</label>` : ""}</div>`;
    const body =
      state.view === "tree"
        ? treeView(librarySets(null))
        : gridView(sets, folderId);
    return header + body + (state.query ? searchResults() : "");
  }
  function gridView(sets, folderId) {
    const q = normalize(state.query),
      folders = store
        .list("folder")
        .filter((f) =>
          state.query
            ? (!folderId ||
                descendantFolders(store.records, folderId).has(f.id)) &&
              normalize(f.name).includes(q)
            : f.parentId === (folderId || null),
        )
        .sort((a, b) => a.name.localeCompare(b.name));
    const pickedHere = sets.filter((s) => state.selected.has(s.id)).length,
      picked = state.selected.size;
    return `<p class="muted library-hint" id="libraryHint">Drag a set onto a folder (or a folder in the path above) to move it. No mouse? Use <strong>Move</strong> on a set, or select sets and choose <strong>Move selected to…</strong>.</p>${
      folders.length
        ? `<section aria-labelledby="folderHeading"><h2 id="folderHeading" class="section-title">Folders</h2><div class="folder-grid">${folders
            .map((f) => {
              const sum = folderSummary(f.id);
              return `<article class="folder-card" data-folder-id="${attr(f.id)}" draggable="true" data-drag-folder="${attr(f.id)}" data-drop-folder="${attr(f.id)}"><span class="folder-icon" aria-hidden="true">📁</span><div class="folder-card-body"><a class="folder-name" href="#folder/${attr(f.id)}">${esc(f.name)}</a><small>${plural(sum.sets, "set")} · ${plural(sum.terms, "term")}</small></div><div class="row">${button("Edit", "edit-folder", `data-id="${attr(f.id)}" aria-label="Edit folder ${attr(f.name)}"`, "small")}${button("➡️ Move", "move-folder", `data-id="${attr(f.id)}" aria-label="Move folder ${attr(f.name)} to another folder…"`, "small")}</div></article>`;
            })
            .join("")}</div></section>`
        : ""
    }${(() => {
      const list = libraryTranscripts(folderId);
      return list.length
        ? `<section aria-labelledby="transcriptHeading"><h2 id="transcriptHeading" class="section-title">Transcripts</h2><div class="transcript-rows">${list.map((t) => `<article class="transcript-row" data-transcript-id="${attr(t.id)}" draggable="true" data-drag-transcript="${attr(t.id)}"><span aria-hidden="true">🎙️</span><a class="transcript-name" href="#transcripts/${attr(t.id)}">${esc(t.title)}</a><small>${date(t.updatedAt)}</small>${button("➡️ Move", "move-transcript", `data-id="${attr(t.id)}" aria-label="Move transcript ${attr(t.title)} to a folder…"`, "small")}</article>`).join("")}</div></section>`
        : "";
    })()}<div class="row between" style="margin:16px 0"><span class="muted" id="setCount">${plural(sets.length, "set")}${folderId ? " in this folder" : state.nested || filtering() ? "" : " not in a folder"}${state.nested && (folderId || folders.length) ? " including subfolders" : ""}${picked ? ` · ${picked} selected` : ""}${picked && pickedHere !== picked ? ` (${picked - pickedHere} not shown)` : ""}</span><div class="row">${button("Select all", "select-all", "", "small")}${picked ? button("Clear", "clear-selected", "", "small") + button(`Move selected to…`, "move-selected", "", "small") + button("Delete selected…", "delete-selected", "", "small danger") : ""}${["flashcards", "learn", "test"].map((mode) => button(`${mode === "flashcards" ? "Flashcards" : mode === "learn" ? "Learn" : "Test"} ${picked ? "selected" : "all"}`, "configure", `data-mode="${mode}" data-source="library"`, "small")).join("")}</div></div>${sets.length ? `<div class="grid" id="setGrid">${sets.map((s) => tile(s, true)).join("")}</div>` : empty("No study sets", filtering() ? "No sets match these filters." : "Create a set or import terms and definitions.", filtering() ? "" : button("Create set", "new-set", "", "primary"))}`;
  }

  /* ---------- tree view ---------- */
  function treeModel(visibleSets) {
    const folders = store.list("folder"),
      shown = new Set(visibleSets.map((s) => s.id)),
      q = normalize(state.query),
      all = store.list("set").filter((s) => !filtering() || shown.has(s.id)),
      setsIn = new Map(),
      kids = new Map();
    for (const s of all) {
      const key = s.folderId && store.get(s.folderId) ? s.folderId : "";
      if (!setsIn.has(key)) setsIn.set(key, []);
      setsIn.get(key).push(s);
    }
    const trIn = new Map();
    for (const t of libraryTranscripts(null)) {
      const key = transcriptFolder(t);
      if (!trIn.has(key)) trIn.set(key, []);
      trIn.get(key).push(t);
    }
    for (const f of folders) {
      const key = f.parentId && store.get(f.parentId) ? f.parentId : "";
      if (!kids.has(key)) kids.set(key, []);
      kids.get(key).push(f);
    }
    // While filtering, keep only folders that lead to a matching set or match by name.
    const keep = new Map();
    const worth = (f) => {
      if (keep.has(f.id)) return keep.get(f.id);
      keep.set(f.id, false);
      const result =
        !filtering() ||
        (q && normalize(f.name).includes(q)) ||
        (setsIn.get(f.id) || []).length > 0 ||
        (trIn.get(f.id) || []).length > 0 ||
        (kids.get(f.id) || []).some(worth);
      keep.set(f.id, result);
      return result;
    };
    const byName = (a, b) => a.name.localeCompare(b.name),
      byTitle = (a, b) => a.title.localeCompare(b.title);
    const build = (parent) => [
      ...(kids.get(parent) || [])
        .filter(worth)
        .sort(byName)
        .map((f) => ({ kind: "folder", item: f, children: build(f.id) })),
      ...(setsIn.get(parent) || [])
        .sort(byTitle)
        .map((s) => ({ kind: "set", item: s })),
      ...(trIn.get(parent) || [])
        .sort((a, b) => a.title.localeCompare(b.title))
        .map((t) => ({ kind: "transcript", item: t })),
    ];
    return build("");
  }
  function openIds(model) {
    if (state.openAll || filtering()) {
      const ids = new Set();
      const walk = (nodes) =>
        nodes.forEach((n) => {
          if (n.kind === "folder") {
            ids.add(n.item.id);
            walk(n.children);
          }
        });
      walk(model);
      return ids;
    }
    const ids = new Set(state.open);
    // The folder being viewed is always visible in the tree.
    for (
      let f = store.get(state.folderId), seen = new Set();
      f && !seen.has(f.id);
      f = store.get(f.parentId)
    ) {
      seen.add(f.id);
      ids.add(f.id);
    }
    return ids;
  }
  function treeView(sets) {
    const model = treeModel(sets),
      open = openIds(model);
    // Roving tabindex: exactly one row is in the Tab order, the current one if it is still
    // shown, otherwise the first row.
    const flat = [];
    const walk = (nodes) =>
      nodes.forEach((n) => {
        flat.push(n);
        if (n.children) walk(n.children);
      });
    walk(model);
    const stop =
      flat.find(
        (n) =>
          state.current &&
          n.kind === state.current.kind &&
          n.item.id === state.current.id,
      ) || flat[0];
    const row = (node, level, size, pos) => {
      const isFolder = node.kind === "folder",
        item = node.item,
        id = item.id,
        isOpen = isFolder && open.has(id),
        picked = !isFolder && state.selected.has(id),
        current =
          !!state.current &&
          state.current.kind === node.kind &&
          state.current.id === id,
        tab = node === stop;
      const label = isFolder ? item.name : item.title,
        meta = isFolder
          ? (() => {
              const sum = folderSummary(id);
              return `${plural(sum.sets, "set")} · ${plural(sum.terms, "term")}`;
            })()
          : node.kind === "transcript"
            ? "Transcript"
            : `${plural(counts(id).terms, "term")}${item.subject ? " · " + esc(item.subject) : ""}`;
      return `<li role="treeitem" aria-level="${level}" aria-setsize="${size}" aria-posinset="${pos}" ${isFolder ? `aria-expanded="${isOpen}"` : `aria-selected="${picked}"`} tabindex="${tab ? 0 : -1}" data-kind="${node.kind}" data-id="${attr(id)}" data-label="${attr(label)}"${state.folderId === id && isFolder ? ' aria-current="location"' : ""}><div class="tree-row${picked ? " is-selected" : ""}${current ? " is-current" : ""}${isFolder && state.folderId === id ? " is-location" : ""}" draggable="true" data-drag-${node.kind}="${attr(id)}"${isFolder ? ` data-drop-folder="${attr(id)}"` : ""}><span class="tree-toggle" aria-hidden="true">${isFolder ? (isOpen ? "▾" : "▸") : ""}</span><span class="tree-icon" aria-hidden="true">${isFolder ? "📁" : node.kind === "transcript" ? "🎙️" : "📄"}</span><span class="tree-label">${esc(label)}</span><span class="tree-meta">${isFolder ? esc(meta) : meta}</span></div>${isFolder ? `<ul role="group" ${isOpen ? "" : "hidden"}>${node.children.map((c, i) => row(c, level + 1, node.children.length, i + 1)).join("")}</ul>` : ""}</li>`;
    };
    const rootCount = model.length;
    return `<p class="muted library-hint" id="libraryHint">Tree keys: <kbd>↑</kbd> <kbd>↓</kbd> move, <kbd>→</kbd> <kbd>←</kbd> open or close a folder, <kbd>Enter</kbd> open a set or toggle a folder, <kbd>Space</kbd> select a set, <kbd>Shift</kbd>+<kbd>M</kbd> move, or type a name. Drag rows onto a folder to move them.</p><div class="tree-actions" id="treeActions" role="group" aria-label="Actions for the selected item"></div><div class="tree-wrap"><div class="tree-root-drop" data-drop-folder="" id="treeRoot"><span aria-hidden="true">📄</span> All sets · drop here to move to the top level</div>${rootCount ? `<ul role="tree" id="libraryTree" aria-label="Study library folders and sets" aria-multiselectable="true">${model.map((n, i) => row(n, 1, rootCount, i + 1)).join("")}</ul>` : empty("Nothing to show", filtering() ? "No sets or folders match these filters." : "Create a folder or a set to see it here.")}</div>`;
  }
  const treeEl = () => $("#libraryTree");
  const treeItems = () =>
    treeEl()
      ? [...treeEl().querySelectorAll('[role="treeitem"]')].filter(
          (li) => !li.parentElement.closest("ul[role=group][hidden]"),
        )
      : [];
  function setCurrent(li, { focus = false } = {}) {
    const tree = treeEl();
    if (!tree || !li) return;
    tree.querySelectorAll('[role="treeitem"]').forEach((n) => {
      n.tabIndex = -1;
      n.firstElementChild.classList.remove("is-current");
    });
    li.tabIndex = 0;
    li.firstElementChild.classList.add("is-current");
    state.current = { kind: li.dataset.kind, id: li.dataset.id };
    if (focus) li.focus();
    syncActions();
  }
  function syncSelection() {
    treeEl()
      ?.querySelectorAll('[data-kind="set"]')
      .forEach((li) => {
        const on = state.selected.has(li.dataset.id);
        li.setAttribute("aria-selected", String(on));
        li.firstElementChild.classList.toggle("is-selected", on);
      });
    syncActions();
  }
  function targets() {
    if (state.selected.size)
      return [...state.selected]
        .filter((id) => store.get(id))
        .map((id) => ({ kind: "set", id }));
    return state.current && store.get(state.current.id) ? [state.current] : [];
  }
  function syncActions() {
    const bar = $("#treeActions");
    if (!bar) return;
    const items = targets();
    if (!items.length) {
      bar.innerHTML =
        '<span class="muted">Select a set or folder to see what you can do with it.</span>';
      return;
    }
    const one = items.length === 1 ? items[0] : null,
      record = one && store.get(one.id);
    const name = one
      ? `${one.kind === "folder" ? "Folder" : one.kind === "transcript" ? "Transcript" : "Set"}: ${record.name || record.title}`
      : `${items.length} sets selected`;
    bar.innerHTML = `<strong class="tree-selection">${esc(name)}</strong>${one ? button(one.kind === "folder" ? "Open folder" : one.kind === "transcript" ? "Open transcript" : "Open set", "tree-open", `data-kind="${one.kind}" data-id="${attr(one.id)}"`, "small primary") : ""}${button(items.length > 1 ? `Move ${items.length} sets to…` : "Move to…", "move-items", "", "small")}${one?.kind === "folder" ? button("Edit folder", "edit-folder", `data-id="${attr(one.id)}"`, "small") : ""}${state.selected.size ? button("Clear selection", "clear-selected", "", "small") : ""}`;
  }
  function setExpanded(li, expanded) {
    if (li.dataset.kind !== "folder") return;
    li.setAttribute("aria-expanded", String(expanded));
    li.querySelector(":scope > ul")?.toggleAttribute("hidden", !expanded);
    li.querySelector(":scope > .tree-row .tree-toggle").textContent = expanded
      ? "▾"
      : "▸";
    // Once the learner opens or closes anything, the tree remembers its own state.
    if (state.openAll) {
      state.openAll = false;
      state.open = new Set(
        [...treeEl().querySelectorAll('[data-kind="folder"]')]
          .filter((n) => n.getAttribute("aria-expanded") === "true" || n === li)
          .map((n) => n.dataset.id),
      );
      if (!expanded) state.open.delete(li.dataset.id);
    } else
      expanded
        ? state.open.add(li.dataset.id)
        : state.open.delete(li.dataset.id);
    setPref(OPEN_KEY, JSON.stringify([...state.open]));
  }
  function onTreeKey(e) {
    const li = e.target.closest?.('[role="treeitem"]');
    if (!li || e.target !== li || e.ctrlKey || e.metaKey || e.altKey) return;
    const items = treeItems(),
      i = items.indexOf(li),
      folder = li.dataset.kind === "folder",
      expanded = li.getAttribute("aria-expanded") === "true";
    const go = (target) => {
      if (!target) return;
      e.preventDefault();
      setCurrent(target, { focus: true });
    };
    if (e.key === "ArrowDown") go(items[i + 1]);
    else if (e.key === "ArrowUp") go(items[i - 1]);
    else if (e.key === "Home") go(items[0]);
    else if (e.key === "End") go(items.at(-1));
    else if (e.key === "ArrowRight") {
      if (folder && !expanded) {
        e.preventDefault();
        setExpanded(li, true);
      } else if (folder && expanded) go(items[i + 1]);
    } else if (e.key === "ArrowLeft") {
      if (folder && expanded) {
        e.preventDefault();
        setExpanded(li, false);
      } else go(li.parentElement.closest('[role="treeitem"]'));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (folder) setExpanded(li, !expanded);
      else
        ctx.go(
          (li.dataset.kind === "transcript" ? "transcripts/" : "set/") +
            li.dataset.id,
        );
    } else if (e.key === " ") {
      e.preventDefault();
      if (li.dataset.kind === "set") {
        const id = li.dataset.id;
        state.selected.has(id)
          ? state.selected.delete(id)
          : state.selected.add(id);
        syncSelection();
      }
    } else if (e.key === "*" && folder) {
      e.preventDefault();
      for (const sib of li.parentElement.children)
        if (sib.dataset.kind === "folder") setExpanded(sib, true);
    } else if (e.shiftKey && e.key.toLowerCase() === "m") {
      e.preventDefault();
      moveDialog(targets());
    } else if (e.key.length === 1 && !e.shiftKey) {
      // Type-ahead: jump to the next row whose name starts with what was typed.
      const t = Date.now();
      typeahead.text =
        (t - typeahead.at > 700 ? "" : typeahead.text) + e.key.toLowerCase();
      typeahead.at = t;
      const order = [...items.slice(i + 1), ...items.slice(0, i + 1)];
      go(
        order.find((n) =>
          n.dataset.label.toLowerCase().startsWith(typeahead.text),
        ),
      );
    }
  }

  /* ---------- moving ---------- */
  function destinationName(target) {
    return target
      ? `“${store.get(target)?.name || "folder"}”`
      : "the top level";
  }
  async function moveItems(kind, ids, target) {
    const wanted = new Set(ids);
    const moving = [...wanted].filter((id) => {
      const r = store.get(id);
      return r && (r[fieldOf(kind)] || "") !== (target || "");
    });
    if (!moving.length) {
      toast(`Already in ${destinationName(target)}.`);
      return false;
    }
    if (kind === "folder")
      for (const id of moving)
        validateFolderMove(store.records, id, target || null);
    const first = store.get(moving[0]),
      what =
        moving.length === 1
          ? `“${first.title || first.name}”`
          : `${moving.length} ${nounOf(kind, moving.length)}`;
    const moved = new Set(moving);
    await store.change(`Move ${nounOf(kind)}`, (rows) =>
      rows.map((r) =>
        moved.has(r.id) && !r.deleted
          ? { ...r, [fieldOf(kind)]: target || null }
          : r,
      ),
    );
    state.selected.clear();
    // Reveal where it went when the tree would otherwise hide it.
    if (target) {
      state.open.add(target);
      setPref(OPEN_KEY, JSON.stringify([...state.open]));
    }
    await ctx.render();
    toast(`Moved ${what} to ${destinationName(target)}.`);
    // A closing dialog hands focus back to the control that opened it, which no longer
    // exists after the redraw; move focus to the moved item once the dialog is gone.
    setTimeout(() => focusAfterMove(kind, moving[0]), 0);
    return true;
  }
  function focusAfterMove(kind, id) {
    const target =
      document.querySelector(`[role=treeitem][data-id="${CSS.escape(id)}"]`) ||
      document.querySelector(
        `[data-set-id="${CSS.escape(id)}"] .set-title, [data-folder-id="${CSS.escape(id)}"] .folder-name`,
      ) ||
      $("#view h1");
    if (target) {
      if (!target.matches("a,button,[tabindex]")) target.tabIndex = -1;
      target.focus({ preventScroll: false });
    }
  }
  function moveDialog(items) {
    const live = items.filter((i) => store.get(i.id));
    if (!live.length) {
      toast("Choose a set or folder to move first.");
      return;
    }
    const kind = live[0].kind;
    if (live.some((i) => i.kind !== kind)) {
      toast("Move sets and folders separately.");
      return;
    }
    const ids = live.map((i) => i.id),
      first = store.get(ids[0]);
    // A folder cannot move into itself or one of its subfolders.
    const exclude =
      kind === "folder"
        ? new Set(
            ids.flatMap((id) => [...descendantFolders(store.records, id)]),
          )
        : null;
    const where = first[fieldOf(kind)] || "";
    const name =
      ids.length === 1
        ? `“${first.title || first.name}”`
        : `${ids.length} ${nounOf(kind, ids.length)}`;
    modal(
      `Move ${name}`,
      `<p class="muted">Choose the folder to move ${ids.length === 1 ? "it" : "them"} to. ${kind === "transcript" ? "The text and audio stay as they are." : `Cards, progress and history stay with ${kind === "set" ? "each set" : "the sets"}.`}</p>${selectField("Destination folder", "destination", folderOptions(exclude), where)}`,
      true,
      async (fd) => {
        await moveItems(kind, ids, fd.get("destination") || "");
      },
      { submitLabel: "Move here" },
    );
  }

  // Two confirmations: first a summary, then the word DELETE must be typed.
  function deleteSelected() {
    const sets = [...state.selected].map((id) => store.get(id)).filter(Boolean);
    if (!sets.length) return toast("Select the sets to delete first.");
    const ids = new Set(sets.map((x) => x.id)),
      terms = cardsFor_all(ids),
      list = sets
        .slice(0, 8)
        .map((x) => `<li>${esc(x.title)}</li>`)
        .join("");
    modal(
      `Delete ${plural(sets.length, "set")}? (step 1 of 2)`,
      `<p>These sets and their ${plural(terms, "term")} will move to Recently Deleted:</p><ul>${list}${sets.length > 8 ? `<li>…and ${sets.length - 8} more</li>` : ""}</ul><p class="muted">Test attempts and learning history are kept. You can restore them from Recently Deleted.</p>`,
      true,
      () => {
        setTimeout(() => confirmTyped(sets, ids), 0);
      },
      { submitLabel: "Continue" },
    );
  }
  const cardsFor_all = (ids) =>
    store.list("card").filter((c) => ids.has(c.setId)).length;
  function confirmTyped(sets, ids) {
    modal(
      "Type DELETE to confirm (step 2 of 2)",
      `<p>This moves ${plural(sets.length, "set")} to Recently Deleted.</p><label>Type <strong>DELETE</strong> to confirm<input name="word" autocomplete="off" required></label>`,
      true,
      async (fd) => {
        if (String(fd.get("word")).trim() !== "DELETE")
          throw new Error("Type DELETE exactly, in capitals, to confirm.");
        const at = new Date().toISOString();
        await store.change(`Delete ${sets.length} sets`, (rows) =>
          rows.map((r) =>
            !r.deleted &&
            (ids.has(r.id) || (r.type === "card" && ids.has(r.setId)))
              ? {
                  ...r,
                  deleted: true,
                  deletedAt: at,
                  deletedWith: r.type === "card" ? r.setId : r.id,
                }
              : r,
          ),
        );
        state.selected.clear();
        await ctx.render();
        toast(
          `Deleted ${plural(sets.length, "set")}. Restore from Recently Deleted.`,
        );
      },
      { submitLabel: "Delete sets" },
    );
  }

  /* ---------- drag and drop ---------- */
  function canDrop(target) {
    if (!drag) return false;
    if (drag.kind !== "folder")
      return drag.ids.some((id) => (store.get(id)?.folderId || "") !== target);
    return drag.ids.every((id) => {
      const f = store.get(id);
      if (!f || (f.parentId || "") === target) return false;
      try {
        validateFolderMove(store.records, id, target || null);
        return true;
      } catch {
        return false;
      }
    });
  }
  const clearDropMarks = () => {
    clearTimeout(hoverTimer);
    document
      .querySelectorAll(".drop-target")
      .forEach((n) => n.classList.remove("drop-target"));
  };
  function dragImage(e, count, label) {
    if (!e.dataTransfer.setDragImage) return;
    const ghost = document.createElement("div");
    ghost.className = "drag-ghost";
    ghost.textContent = count > 1 ? `${count} items` : label;
    document.body.append(ghost);
    e.dataTransfer.setDragImage(ghost, 12, 12);
    setTimeout(() => ghost.remove());
  }
  document.addEventListener("dragstart", (e) => {
    const source = e.target.closest?.(
      "[data-drag-set],[data-drag-folder],[data-drag-transcript]",
    );
    if (!source || !$("#view").contains(source)) return;
    const kind = source.dataset.dragSet
        ? "set"
        : source.dataset.dragTranscript
          ? "transcript"
          : "folder",
      id =
        source.dataset.dragSet ||
        source.dataset.dragTranscript ||
        source.dataset.dragFolder;
    // Dragging a selected set moves the whole selection, like a file manager.
    const ids =
      kind === "set" && state.selected.has(id) && state.selected.size > 1
        ? [...state.selected]
        : [id];
    drag = { kind, ids };
    e.dataTransfer.effectAllowed = "move";
    const record = store.get(id);
    e.dataTransfer.setData("text/plain", record?.title || record?.name || "");
    dragImage(e, ids.length, record?.title || record?.name || "");
    requestAnimationFrame(() =>
      ids.forEach((moving) =>
        document
          .querySelectorAll(
            `[data-drag-set="${CSS.escape(moving)}"],[data-drag-folder="${CSS.escape(moving)}"],[data-drag-transcript="${CSS.escape(moving)}"]`,
          )
          .forEach((n) => n.classList.add("is-dragging")),
      ),
    );
  });
  document.addEventListener("dragover", (e) => {
    const zone = drag && e.target.closest?.("[data-drop-folder]");
    if (!zone || !canDrop(zone.dataset.dropFolder)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  });
  document.addEventListener("dragenter", (e) => {
    const zone = drag && e.target.closest?.("[data-drop-folder]");
    clearDropMarks();
    if (!zone || !canDrop(zone.dataset.dropFolder)) return;
    zone.classList.add("drop-target");
    // Hovering over a closed tree folder opens it, as in a file manager.
    const li = zone.closest('[role="treeitem"]');
    if (li?.getAttribute("aria-expanded") === "false")
      hoverTimer = setTimeout(() => setExpanded(li, true), 500);
  });
  document.addEventListener("dragleave", (e) => {
    const zone = e.target.closest?.("[data-drop-folder]");
    if (zone && !zone.contains(e.relatedTarget)) {
      zone.classList.remove("drop-target");
      clearTimeout(hoverTimer);
    }
  });
  document.addEventListener("drop", (e) => {
    const zone = drag && e.target.closest?.("[data-drop-folder]");
    if (!zone) return;
    e.preventDefault();
    const target = zone.dataset.dropFolder,
      current = drag;
    clearDropMarks();
    if (!canDrop(target)) return;
    moveItems(current.kind, current.ids, target).catch((error) =>
      toast(error.message),
    );
  });
  document.addEventListener("dragend", () => {
    drag = null;
    clearDropMarks();
    document
      .querySelectorAll(".is-dragging")
      .forEach((n) => n.classList.remove("is-dragging"));
  });

  /* ---------- wiring ---------- */
  function bind() {
    const search = $("#librarySearch");
    if (search)
      search.oninput = (e) => {
        state.query = e.target.value;
        ctx.debouncedRender("librarySearch");
      };
    for (const [selector, key] of [
      ["librarySort", "sort"],
      ["subjectFilter", "subject"],
      ["starSearch", "starred"],
      ["nestedFolders", "nested"],
    ]) {
      const el = $("#" + selector);
      if (el)
        el.onchange = () => {
          state[key] = el.type === "checkbox" ? el.checked : el.value;
          if (key === "nested") setPref(NESTED_KEY, state.nested ? "1" : "0");
          ctx.render();
        };
    }
    const jump = $("#folderJump");
    if (jump)
      jump.onchange = () =>
        ctx.go(jump.value ? "folder/" + jump.value : "library");
    document.querySelectorAll("[data-select-set]").forEach(
      (el) =>
        (el.onchange = async () => {
          el.checked
            ? state.selected.add(el.dataset.selectSet)
            : state.selected.delete(el.dataset.selectSet);
          await ctx.render();
          // Keep keyboard focus on the checkbox that was just used.
          document
            .querySelector(
              `[data-select-set="${CSS.escape(el.dataset.selectSet)}"]`,
            )
            ?.focus();
        }),
    );
    if (treeEl()) {
      treeEl().onkeydown = onTreeKey;
      treeEl().onfocusin = (e) => {
        const li = e.target.closest?.('[role="treeitem"]');
        if (li && e.target === li && state.current?.id !== li.dataset.id)
          setCurrent(li);
      };
      treeEl().onclick = (e) => {
        const row = e.target.closest(".tree-row"),
          li = row?.parentElement;
        if (!li) return;
        if (e.target.closest(".tree-toggle")) {
          setExpanded(li, li.getAttribute("aria-expanded") !== "true");
          setCurrent(li, { focus: true });
          return;
        }
        setCurrent(li, { focus: true });
        if (li.dataset.kind === "set") {
          const id = li.dataset.id;
          if (e.ctrlKey || e.metaKey || e.shiftKey)
            state.selected.has(id)
              ? state.selected.delete(id)
              : state.selected.add(id);
          else state.selected = new Set([id]);
        } else if (!(e.ctrlKey || e.metaKey || e.shiftKey))
          state.selected.clear();
        syncSelection();
      };
      treeEl().ondblclick = (e) => {
        const li = e.target.closest?.('[role="treeitem"]');
        if (!li || e.target.closest(".tree-toggle")) return;
        li.dataset.kind === "folder"
          ? ctx.go("folder/" + li.dataset.id)
          : ctx.go(
              (li.dataset.kind === "transcript" ? "transcripts/" : "set/") +
                li.dataset.id,
            );
      };
      syncActions();
    }
  }
  // Returns true when the action belongs to the library.
  async function handle(action, el) {
    if (action === "library-view") {
      state.view = el.dataset.view === "tree" ? "tree" : "grid";
      setPref(VIEW_KEY, state.view);
      await ctx.render();
      document
        .querySelector(
          `[data-action="library-view"][data-view="${state.view}"]`,
        )
        ?.focus();
    } else if (action === "move-transcript")
      moveDialog([{ kind: "transcript", id: el.dataset.id }]);
    else if (action === "move-set")
      moveDialog([{ kind: "set", id: el.dataset.id }]);
    else if (action === "move-folder")
      moveDialog([{ kind: "folder", id: el.dataset.id }]);
    else if (action === "move-selected")
      moveDialog([...state.selected].map((id) => ({ kind: "set", id })));
    else if (action === "move-items") moveDialog(targets());
    else if (action === "tree-open")
      ctx.go(
        (el.dataset.kind === "folder"
          ? "folder/"
          : el.dataset.kind === "transcript"
            ? "transcripts/"
            : "set/") + el.dataset.id,
      );
    else if (action === "select-all") {
      librarySets().forEach((s) => state.selected.add(s.id));
      ctx.render();
    } else if (action === "delete-selected") deleteSelected();
    else if (action === "clear-selected") {
      state.selected.clear();
      state.view === "tree" ? syncSelection() : ctx.render();
    } else return false;
    return true;
  }
  return {
    state,
    view,
    bind,
    handle,
    tile,
    librarySets,
    folderPath,
    folderOptions,
    cardsFor,
    counts,
  };
}
