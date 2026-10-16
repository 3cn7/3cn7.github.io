// Shared records, imports, and study-pool selection. No DOM or network dependencies.
export const SCHEMA = 1;
export const id = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export const clone = (value) => structuredClone(value);
export const normalize = (value) =>
  String(value ?? "")
    .normalize("NFC")
    .toLocaleLowerCase()
    .replace(/[’‘]/g, "'")
    .trim()
    .replace(/\s+/gu, " ");
export const record = (type, data = {}) => ({
  id: id(),
  type,
  createdAt: now(),
  updatedAt: now(),
  deleted: false,
  clock: {},
  ...data,
});
export function createStudySet(data = {}) {
  return record("set", {
    title: "Untitled set",
    description: "",
    subject: "",
    folderId: null,
    termLanguage: "it",
    definitionLanguage: "en",
    pinned: false,
    lastStudiedAt: null,
    ...data,
  });
}
export function createFlashcard(setId, data = {}, order = 0) {
  return record("card", {
    setId,
    term: "",
    definition: "",
    acceptedAnswers: [],
    termAnswers: [],
    notes: "",
    explanation: "",
    imageRef: "",
    starred: false,
    tags: [],
    order,
    contentRevision: 1,
    revisions: [],
    ...data,
  });
}
export function updateFlashcard(card, patch) {
  const changed = ["term", "definition", "acceptedAnswers", "termAnswers"].some(
    (key) =>
      key in patch && JSON.stringify(card[key]) !== JSON.stringify(patch[key]),
  );
  return {
    ...card,
    ...patch,
    updatedAt: now(),
    contentRevision: card.contentRevision + (changed ? 1 : 0),
    revisions: changed
      ? [
          ...(card.revisions || []),
          {
            term: card.term,
            definition: card.definition,
            acceptedAnswers: card.acceptedAnswers,
            termAnswers: card.termAnswers,
            at: card.updatedAt,
            revision: card.contentRevision,
          },
        ].slice(-20)
      : card.revisions,
  };
}
export function descendantFolders(records, folderId, includeSelf = true) {
  const result = new Set(includeSelf ? [folderId] : []),
    queue = [folderId];
  while (queue.length) {
    const parent = queue.shift();
    for (const f of records.filter(
      (r) => r.type === "folder" && !r.deleted && r.parentId === parent,
    )) {
      if (!result.has(f.id)) {
        result.add(f.id);
        queue.push(f.id);
      }
    }
  }
  return result;
}
export function validateFolderMove(records, folderId, parentId) {
  if (
    parentId &&
    (folderId === parentId ||
      descendantFolders(records, folderId).has(parentId))
  )
    throw new Error(
      "A folder cannot be moved into itself or one of its subfolders.",
    );
  if (
    parentId &&
    !records.some((r) => r.type === "folder" && r.id === parentId)
  )
    throw new Error("Destination folder does not exist.");
}
export function getEligibleCards(
  records,
  {
    setIds = [],
    folderId = null,
    nested = true,
    filter = "all",
    direction = "forward",
    subject = "",
    query = "",
    cardIds = null,
  } = {},
) {
  const live = records.filter((r) => !r.deleted);
  const folders = folderId
    ? nested
      ? descendantFolders(live, folderId)
      : new Set([folderId])
    : null;
  const sets = new Map(
    live
      .filter(
        (r) =>
          r.type === "set" &&
          (!setIds.length || setIds.includes(r.id)) &&
          (!folders || folders.has(r.folderId)) &&
          (!subject || r.subject === subject),
      )
      .map((r) => [r.id, r]),
  );
  const progress = new Map(
    live.filter((r) => r.type === "learning").map((r) => [r.id, r]),
  );
  const attempts = live.filter((r) => r.type === "attempt");
  const tests = live
    .filter((r) => r.type === "test" && r.submittedAt)
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  const misses = (kind) =>
    new Set(
      (kind === "learn" ? attempts.filter((a) => !a.effectiveCorrect) : []).map(
        (a) => a.cardId,
      ),
    );
  const missedLearn = misses("learn"),
    missedTest = new Set(
      tests.flatMap((t) =>
        (t.results || [])
          .filter((r) => !r.effectiveCorrect)
          .map((r) => r.cardId),
      ),
    );
  const latestBySet = new Map();
  for (const t of tests)
    for (const sid of t.setIds || [])
      if (!latestBySet.has(sid)) latestBySet.set(sid, t);
  const latestMissed = new Set(
    [...latestBySet.values()].flatMap((t) =>
      (t.results || []).filter((r) => !r.effectiveCorrect).map((r) => r.cardId),
    ),
  );
  const directions =
    direction === "mixed" ? ["forward", "reverse"] : [direction];
  const q = normalize(query);
  return live
    .filter((c) => {
      if (
        c.type !== "card" ||
        !sets.has(c.setId) ||
        !c.term.trim() ||
        !c.definition.trim() ||
        (cardIds && !cardIds.includes(c.id))
      )
        return false;
      const states = directions
        .map((d) => progress.get(`${c.id}:${d}`))
        .map((p) =>
          p?.contentRevision === c.contentRevision ? p.status : "NOT_STUDIED",
        );
      const match = {
        all: true,
        starred: c.starred,
        unstarred: !c.starred,
        notStudied: states.every((s) => s === "NOT_STUDIED"),
        learning:
          states.some((s) => s === "LEARNING") ||
          (states.includes("MASTERED") && states.includes("NOT_STUDIED")),
        mastered: states.every((s) => s === "MASTERED"),
        missedLearn: missedLearn.has(c.id),
        missedTest: missedTest.has(c.id),
        missedLatest: latestMissed.has(c.id),
        missed: missedLearn.has(c.id) || missedTest.has(c.id),
      }[filter];
      return (
        match &&
        (!q ||
          normalize(
            [
              c.term,
              c.definition,
              ...(c.acceptedAnswers || []),
              ...(c.termAnswers || []),
              c.notes,
              ...(c.tags || []),
            ].join(" "),
          ).includes(q))
      );
    })
    .sort(
      (a, b) =>
        a.setId.localeCompare(b.setId) ||
        a.order - b.order ||
        a.id.localeCompare(b.id),
    );
}
// Where a term stands across every direction it has been studied in: never answered, still
// being learned, or mastered (every studied direction mastered). One answer for the whole term,
// so mastering a set in either direction, or in both, counts as mastered.
export function termStatus(card, learning) {
  const touched = learning.filter(
    (m) =>
      m.cardId === card.id &&
      m.contentRevision === card.contentRevision &&
      (m.attempts > 0 || m.status !== "NOT_STUDIED"),
  );
  return !touched.length
    ? "NOT_STUDIED"
    : touched.every((m) => m.status === "MASTERED")
      ? "MASTERED"
      : "LEARNING";
}
export function masteredTerms(records, options = {}) {
  const learning = records.filter((r) => r.type === "learning" && !r.deleted);
  return getEligibleCards(records, { ...options, filter: "all" }).filter(
    (c) => termStatus(c, learning) === "MASTERED",
  );
}
export function parseDelimited(text, separator = ",") {
  if (!separator || separator.length !== 1)
    throw new Error("Choose a single character separator.");
  const rows = [];
  let row = [],
    value = "",
    quoted = false;
  text = String(text).replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i++;
      } else if (quoted) quoted = false;
      else if (!value) quoted = true;
      else value += ch;
    } else if (!quoted && ch === separator) {
      row.push(value);
      value = "";
    } else if (!quoted && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(value);
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
      value = "";
    } else value += ch;
  }
  if (quoted) throw new Error("Unclosed quote in imported text.");
  row.push(value);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}
const arrayField = (value) => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {}
  return String(value)
    .split("|")
    .map((v) => v.trim())
    .filter(Boolean);
};
export function parseCards(text, format = "tsv", separator = "\t") {
  let rows;
  if (format === "json") {
    const obj = JSON.parse(text);
    rows = Array.isArray(obj) ? obj : obj.cards;
    if (!Array.isArray(rows))
      throw new Error("JSON must contain a cards array.");
  } else {
    const fields = [
      "term",
      "definition",
      "acceptedAnswers",
      "notes",
      "explanation",
      "starred",
      "tags",
      "termAnswers",
      "imageRef",
    ];
    const parsed = parseDelimited(text, format === "csv" ? "," : separator);
    const header = parsed[0]?.map(normalize);
    const hasHeader =
      header?.includes("term") && header?.includes("definition");
    rows = (hasHeader ? parsed.slice(1) : parsed).map((row) =>
      Object.fromEntries(
        (hasHeader ? header : fields).map((name, i) => [name, row[i] ?? ""]),
      ),
    );
  }
  if (rows.length > 50000)
    throw new Error("Import at most 50,000 cards at once.");
  return rows.map((r, i) => {
    if (!r || typeof r.term !== "string" || typeof r.definition !== "string")
      throw new Error(`Row ${i + 1} needs a term and definition.`);
    return {
      term: r.term,
      definition: r.definition,
      acceptedAnswers: Array.isArray(r.acceptedAnswers)
        ? r.acceptedAnswers.map(String)
        : arrayField(r.acceptedanswers || r.acceptedAnswers),
      termAnswers: Array.isArray(r.termAnswers)
        ? r.termAnswers.map(String)
        : arrayField(r.termanswers || r.termAnswers),
      notes: String(r.notes || ""),
      explanation: String(r.explanation || ""),
      imageRef: String(r.imageref || r.imageRef || ""),
      starred: r.starred === true || r.starred === "true",
      tags: Array.isArray(r.tags) ? r.tags.map(String) : arrayField(r.tags),
    };
  });
}
export function exportCards(set, cards, format = "json") {
  if (format === "json")
    return JSON.stringify({ schemaVersion: SCHEMA, set, cards }, null, 2);
  const fields =
    format === "csv"
      ? [
          "term",
          "definition",
          "acceptedAnswers",
          "notes",
          "explanation",
          "starred",
          "tags",
          "termAnswers",
          "imageRef",
        ]
      : ["term", "definition"];
  const sep = format === "csv" ? "," : "\t";
  const quote = (v) =>
    '"' +
    String(Array.isArray(v) ? JSON.stringify(v) : (v ?? "")).replace(
      /"/g,
      '""',
    ) +
    '"';
  return [fields, ...cards.map((c) => fields.map((k) => c[k]))]
    .map((r) => r.map(quote).join(sep))
    .join("\r\n");
}
export function validateBackup(input, { partial = false } = {}) {
  if (
    !input ||
    input.app !== "Study Platform" ||
    input.schemaVersion !== SCHEMA ||
    !Array.isArray(input.records)
  )
    throw new Error("This is not a supported Study Platform backup.");
  const ids = new Set(),
    types = new Set([
      "set",
      "card",
      "folder",
      "learning",
      "attempt",
      "session",
      "test",
      "transcript",
      "preferences",
    ]);
  if (input.records.length > 300000)
    throw new Error("Backup contains too many records.");
  for (const r of input.records) {
    if (
      !r ||
      typeof r.id !== "string" ||
      !r.id ||
      ids.has(r.id) ||
      !types.has(r.type) ||
      typeof r.clock !== "object" ||
      !r.clock ||
      Array.isArray(r.clock) ||
      Object.values(r.clock).some((n) => !Number.isSafeInteger(n) || n < 0)
    )
      throw new Error("Invalid or duplicate backup record.");
    if (r.deleted && r.erased) {
      ids.add(r.id);
      continue;
    }
    if (
      r.type === "card" &&
      (typeof r.term !== "string" ||
        typeof r.definition !== "string" ||
        typeof r.setId !== "string")
    )
      throw new Error("Invalid card in backup.");
    if (r.type === "set" && typeof r.title !== "string")
      throw new Error("Invalid set in backup.");
    if (r.type === "folder" && typeof r.name !== "string")
      throw new Error("Invalid folder in backup.");
    if (
      r.type === "learning" &&
      (!["forward", "reverse"].includes(r.direction) ||
        !["NOT_STUDIED", "LEARNING", "MASTERED"].includes(r.status) ||
        !Number.isInteger(r.contentRevision))
    )
      throw new Error("Invalid learning state in backup.");
    if (
      r.type === "attempt" &&
      (typeof r.cardId !== "string" ||
        typeof r.response !== "string" ||
        typeof r.effectiveCorrect !== "boolean")
    )
      throw new Error("Invalid attempt in backup.");
    if (
      r.type === "session" &&
      (!["learn", "flashcards"].includes(r.mode) ||
        !Array.isArray(r.cardIds) ||
        !Array.isArray(r.setIds) ||
        !r.config ||
        (r.mode === "learn" && (!r.states || !Array.isArray(r.attempts))) ||
        (r.mode === "flashcards" && !Array.isArray(r.sequence)))
    )
      throw new Error("Invalid study session in backup.");
    if (
      r.type === "test" &&
      (!Array.isArray(r.questions) ||
        !Array.isArray(r.results) ||
        !Array.isArray(r.setIds) ||
        !r.answers ||
        r.questions.some(
          (q) =>
            typeof q.id !== "string" ||
            typeof q.prompt !== "string" ||
            typeof q.correctAnswer !== "string" ||
            !["mc", "tf", "written", "spelling"].includes(q.type),
        ))
    )
      throw new Error("Invalid frozen test in backup.");
    if (
      r.type === "transcript" &&
      (typeof r.rawText !== "string" ||
        !Array.isArray(r.segments) ||
        r.segments.some(
          (s) =>
            typeof s.text !== "string" ||
            !Number.isFinite(s.start) ||
            !Number.isFinite(s.end) ||
            s.end < s.start,
        ))
    )
      throw new Error("Invalid transcript in backup.");
    ids.add(r.id);
  }
  if (!partial)
    for (const r of input.records) {
      if (r.type === "folder" && !r.deleted)
        validateFolderMove(input.records, r.id, r.parentId);
      if (
        r.type === "card" &&
        !r.erased &&
        !input.records.some((s) => s.type === "set" && s.id === r.setId)
      )
        throw new Error("Card references a missing set.");
    }
  return clone(input);
}
export const makeBackup = (records) => ({
  app: "Study Platform",
  schemaVersion: SCHEMA,
  exportedAt: now(),
  records: clone(records),
});
