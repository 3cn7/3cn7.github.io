import { makeBackup, validateBackup, now } from "./core.js";
// Versioned feature migration: the record wire format and original stores remain compatible.
export async function prepareStudyOnly(store) {
  if (await store.meta("studyOnlyMigration")) return;
  const entries = Object.fromEntries(
    Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)]),
  );
  const backup = {
    version: 2,
    createdAt: now(),
    study: validateBackup(makeBackup(store.records)),
    localStorage: entries,
  };
  const tx = store.db.transaction(["records", "meta"], "readwrite");
  await new Promise((resolve, reject) => {
    const req = tx.objectStore("records").getAll();
    req.onsuccess = () => {
      try {
        backup.study = validateBackup(makeBackup(req.result));
        const meta = tx.objectStore("meta");
        meta.put({ id: "beforeStudyOnlyMigration", value: backup });
        meta.put({
          id: "studyOnlyMigration",
          value: {
            version: 2,
            completedAt: now(),
            recordCount: req.result.length,
          },
        });
      } catch (e) {
        tx.abort();
        reject(e);
      }
    };
    tx.oncomplete = resolve;
    tx.onabort = () =>
      reject(
        tx.error ||
          new Error(
            "Migration backup could not be saved. No data was changed.",
          ),
      );
  });
  // Carry forward only shared preferences, discovered by shape rather than a retired feature dependency.
  for (const value of Object.values(entries)) {
    let saved;
    try {
      saved = JSON.parse(value);
    } catch {
      continue;
    }
    if (!saved || typeof saved !== "object") continue;
    if (
      !localStorage.getItem("studyPlatform.oauthClientId") &&
      typeof saved.clientId === "string" &&
      saved.clientId.endsWith(".apps.googleusercontent.com")
    )
      localStorage.setItem("studyPlatform.oauthClientId", saved.clientId);
    if (
      !localStorage.getItem("studyPlatform.timer.v2") &&
      Number.isFinite(saved.durationMs) &&
      Number.isFinite(saved.remainingMs) &&
      "endsAt" in saved
    ) {
      localStorage.setItem(
        "studyPlatform.timer.v2",
        JSON.stringify({
          mode: "countdown",
          durationMs: saved.lastSetDurationMs || saved.durationMs || 1500000,
          valueMs: saved.remainingMs,
          anchor: saved.endsAt,
          running: !!saved.running,
          visible: false,
          sound: false,
          notify: false,
          completed: false,
        }),
      );
    }
  }
}
