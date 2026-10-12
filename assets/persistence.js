import {
  id,
  now,
  clone,
  makeBackup,
  validateBackup,
  validateFolderMove,
} from "./core.js";
export function compareClocks(a = {}, b = {}) {
  let ahead = false,
    behind = false;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if ((a[key] || 0) > (b[key] || 0)) ahead = true;
    if ((a[key] || 0) < (b[key] || 0)) behind = true;
  }
  return ahead && behind
    ? "concurrent"
    : ahead
      ? "ahead"
      : behind
        ? "behind"
        : "equal";
}
export const joinClocks = (a = {}, b = {}) =>
  Object.fromEntries(
    [...new Set([...Object.keys(a), ...Object.keys(b)])].map((k) => [
      k,
      Math.max(a[k] || 0, b[k] || 0),
    ]),
  );
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical(value[k])]),
    );
  return value;
}
const content = (r) =>
  JSON.stringify(
    canonical(
      Object.fromEntries(
        Object.entries(r).filter(([k]) => !["clock", "updatedAt"].includes(k)),
      ),
    ),
  );
export function mergeRecords(local, remote) {
  const map = new Map(local.map((r) => [r.id, clone(r)])),
    conflicts = [];
  for (const r of remote) {
    const l = map.get(r.id);
    if (!l) {
      map.set(r.id, clone(r));
      continue;
    }
    const relation = compareClocks(l.clock, r.clock);
    if (relation === "behind") map.set(r.id, clone(r));
    else if (relation === "concurrent" || relation === "equal") {
      if (content(l) === content(r))
        map.set(l.id, { ...l, clock: joinClocks(l.clock, r.clock) });
      else conflicts.push({ id: l.id, local: clone(l), remote: clone(r) });
    }
  }
  return { records: [...map.values()], conflicts };
}
const request = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
const finished = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onabort = () =>
      reject(tx.error || new Error("Local database transaction aborted."));
    tx.onerror = () => reject(tx.error);
  });
export class Store extends EventTarget {
  constructor() {
    super();
    this.records = [];
    this.undo = [];
    this.channel = null;
    this.db = null;
    this.device = localStorage.getItem("studyPlatform.device") || id();
    localStorage.setItem("studyPlatform.device", this.device);
  }
  async open() {
    const req = indexedDB.open("studyPlatform.v1", 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("records", { keyPath: "id" });
      req.result.createObjectStore("meta", { keyPath: "id" });
      req.result.createObjectStore("audio", { keyPath: "id" });
    };
    this.db = await request(req);
    this.db.onversionchange = () => {
      this.db.close();
      this.dispatchEvent(
        new CustomEvent("error", {
          detail: "Database upgraded in another tab. Refresh to continue.",
        }),
      );
    };
    await this.refresh();
    if (globalThis.BroadcastChannel) {
      this.channel = new BroadcastChannel("studyPlatform.v1");
      this.channel.onmessage = async () => {
        await this.refresh();
        this.dispatchEvent(
          new CustomEvent("change", { detail: { external: true } }),
        );
      };
    }
    return this;
  }
  async refresh() {
    const tx = this.db.transaction("records");
    this.records = await request(tx.objectStore("records").getAll());
    return this.records;
  }
  list(type, deleted = false) {
    return this.records.filter(
      (r) => r.type === type && (deleted || !r.deleted),
    );
  }
  get(recordId) {
    return this.records.find((r) => r.id === recordId && !r.deleted);
  }
  async change(
    label,
    mutator,
    { remote = false, undo = true, scope = null } = {},
  ) {
    this.lastError = null;
    const tx = this.db.transaction("records", "readwrite"),
      store = tx.objectStore("records");
    const done = finished(tx);
    let next, before;
    const req = store.getAll();
    req.onsuccess = () => {
      try {
        before = clone(req.result);
        next = mutator(clone(before));
        if (!Array.isArray(next)) throw new Error("Invalid local update.");
        const old = new Map(before.map((r) => [r.id, r]));
        for (const value of next) {
          const previous = old.get(value.id);
          if (JSON.stringify(previous) === JSON.stringify(value)) continue;
          const r = clone(value);
          if (r.type === "folder" && !r.deleted)
            validateFolderMove(next, r.id, r.parentId);
          if (!remote) {
            r.clock = joinClocks(previous?.clock, r.clock);
            r.clock[this.device] = (r.clock[this.device] || 0) + 1;
            r.updatedAt = now();
            r.createdAt = r.createdAt || now();
          }
          store.put(r);
        }
      } catch (e) {
        this.lastError = e;
        tx.abort();
      }
    };
    try {
      await done;
    } catch (e) {
      throw this.lastError || e;
    }
    if (undo && !remote) {
      const nextMap = new Map(next.map((r) => [r.id, r])),
        beforeIds = new Set(before.map((r) => r.id));
      const changed = before.filter(
        (r) => JSON.stringify(nextMap.get(r.id)) !== JSON.stringify(r),
      );
      const created = next.filter((r) => !beforeIds.has(r.id)).map((r) => r.id);
      this.undo.push({
        label,
        scope,
        changed,
        created,
        expected: Object.fromEntries(
          next
            .filter(
              (r) =>
                changed.some((c) => c.id === r.id) || created.includes(r.id),
            )
            .map((r) => [
              r.id,
              {
                ...joinClocks(
                  before.find((b) => b.id === r.id)?.clock,
                  r.clock,
                ),
                [this.device]:
                  Math.max(
                    before.find((b) => b.id === r.id)?.clock?.[this.device] ||
                      0,
                    r.clock?.[this.device] || 0,
                  ) + 1,
              },
            ]),
        ),
      });
      if (this.undo.length > 30) this.undo.shift();
    }
    await this.refresh();
    this.channel?.postMessage("change");
    this.dispatchEvent(
      new CustomEvent("change", { detail: { remote, label } }),
    );
  }
  async put(value, options = {}) {
    await this.change(
      "Edit " + value.type,
      (rows) => {
        const old = rows.find((r) => r.id === value.id);
        if (
          old &&
          ["behind", "concurrent"].includes(
            compareClocks(value.clock, old.clock),
          )
        )
          throw new Error(
            "This record changed in another tab. Reopen it before saving. Your draft is still visible.",
          );
        return [...rows.filter((r) => r.id !== value.id), clone(value)];
      },
      options,
    );
    return this.get(value.id);
  }
  async update(recordId, updater, options = {}) {
    await this.change(
      options.label || "Edit record",
      (rows) => rows.map((r) => (r.id === recordId ? updater(r) : r)),
      options,
    );
    return this.get(recordId);
  }
  async putMany(values, options = {}) {
    const map = new Map(values.map((r) => [r.id, r]));
    await this.change(
      options.label || "Add study materials",
      (rows) => {
        for (const r of values) {
          const old = rows.find((v) => v.id === r.id);
          if (
            old &&
            ["behind", "concurrent"].includes(compareClocks(r.clock, old.clock))
          )
            throw new Error(
              "A destination record changed in another tab. Reopen it before saving.",
            );
        }
        return [...rows.filter((r) => !map.has(r.id)), ...values];
      },
      options,
    );
  }
  async remove(recordId) {
    await this.update(
      recordId,
      (r) => ({ ...r, deleted: true, deletedAt: now() }),
      { label: "Delete record" },
    );
  }
  canUndo(scope) {
    const last = this.undo.at(-1);
    return !!last && (scope === undefined || last.scope === scope);
  }
  async undoLast(scope) {
    if (scope !== undefined && this.undo.at(-1)?.scope !== scope) return;
    const item = this.undo.at(-1);
    if (!item) return;
    await this.change(
      "Undo " + item.label,
      (rows) => {
        for (const [key, clock] of Object.entries(item.expected || {})) {
          const current = rows.find((r) => r.id === key);
          if (current && compareClocks(current.clock, clock) !== "equal")
            throw new Error(
              "This change was modified by another tab or device. Undo is paused to preserve newer content.",
            );
        }
        return rows.map((r) =>
          item.created.includes(r.id)
            ? { ...r, deleted: true, deletedAt: now() }
            : item.changed.find((v) => v.id === r.id)
              ? {
                  ...item.changed.find((v) => v.id === r.id),
                  clock: joinClocks(
                    r.clock,
                    item.changed.find((v) => v.id === r.id).clock,
                  ),
                }
              : r,
        );
      },
      { undo: false },
    );
    this.undo.pop();
  }
  async meta(key, value) {
    if (arguments.length === 1) {
      const tx = this.db.transaction("meta");
      return (await request(tx.objectStore("meta").get(key)))?.value;
    }
    const tx = this.db.transaction("meta", "readwrite"),
      done = finished(tx);
    tx.objectStore("meta").put({ id: key, value });
    await done;
  }
  async saveAudio(key, blob, metadata = {}) {
    const tx = this.db.transaction("audio", "readwrite"),
      done = finished(tx);
    tx.objectStore("audio").put({ id: key, blob, ...metadata });
    await done;
  }
  async audio(key) {
    const tx = this.db.transaction("audio");
    return request(tx.objectStore("audio").get(key));
  }
  async deleteAudio(key) {
    const tx = this.db.transaction("audio", "readwrite"),
      done = finished(tx);
    tx.objectStore("audio").delete(key);
    await done;
  }
  async audioList() {
    const tx = this.db.transaction("audio");
    return (await request(tx.objectStore("audio").getAll())).map(
      ({ blob, ...metadata }) => ({
        ...metadata,
        size: blob.size,
        mime: blob.type,
      }),
    );
  }
  async audioUsage() {
    const tx = this.db.transaction("audio");
    const rows = await request(tx.objectStore("audio").getAll());
    return {
      count: rows.length,
      bytes: rows.reduce((s, r) => s + r.blob.size, 0),
    };
  }
  async merge(records) {
    let conflicts = [];
    await this.change(
      "Merge cloud changes",
      (rows) => {
        const merged = mergeRecords(rows, records);
        conflicts = merged.conflicts;
        if (conflicts.length) return rows;
        validateBackup(makeBackup(merged.records));
        return merged.records;
      },
      { remote: true, undo: false },
    );
    return conflicts;
  }
  async restore(input) {
    const backup = validateBackup(input);
    await this.meta("beforeRestore", makeBackup(this.records));
    // Imported material is merged. Conflicting records need review instead of replacing the database.
    let conflicts = [];
    await this.change(
      "Restore backup",
      (rows) => {
        const merged = mergeRecords(rows, backup.records);
        conflicts = merged.conflicts;
        if (conflicts.length) return rows;
        validateBackup(makeBackup(merged.records));
        return merged.records;
      },
      { remote: true },
    );
    return conflicts;
  }
  async resolve(conflict, choice) {
    const chosen = choice === "local" ? conflict.local : conflict.remote;
    await this.put(
      {
        ...chosen,
        clock: joinClocks(conflict.local.clock, conflict.remote.clock),
      },
      { undo: false },
    );
  }
}
