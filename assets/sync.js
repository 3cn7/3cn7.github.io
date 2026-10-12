import { makeBackup, validateBackup, id, now } from "./core.js";
import { mergeRecords } from "./persistence.js";
// New study data uses immutable revision files. Concurrent devices never overwrite one another's uploads.
export class DriveSync extends EventTarget {
  constructor(store, bridge, fetcher = fetch) {
    super();
    this.store = store;
    this.bridge = bridge;
    this.fetcher = fetcher;
    this.state = "SAVED LOCALLY";
    this.error = "";
    this.conflicts = [];
    this.timer = null;
    this.running = null;
    this.pending = true;
    this.enabled = false;
  }
  status(state, error = "") {
    this.state = state;
    this.error = error;
    this.dispatchEvent(new Event("status"));
  }
  async init() {
    this.enabled = Boolean(await this.store.meta("driveEnabled"));
    this.store.addEventListener("change", (e) => {
      if (!e.detail?.remote) {
        this.pending = true;
        this.schedule();
      }
    });
    window.addEventListener("online", () => this.schedule(100));
    window.addEventListener("offline", () => this.status("OFFLINE"));
    this.schedule();
    return this;
  }
  schedule(delay = 5000) {
    clearTimeout(this.timer);
    if (!navigator.onLine) return this.status("OFFLINE");
    if (this.enabled) {
      this.status("SAVED LOCALLY");
      this.timer = setTimeout(() => this.sync().catch(() => {}), delay);
    }
  }
  async api(path, options = {}) {
    const bridge = this.bridge();
    const token = bridge?.token();
    if (!token) throw new Error("AUTHENTICATION REQUIRED");
    const response = await this.fetcher(path, {
      ...options,
      headers: { ...options.headers, Authorization: "Bearer " + token },
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(
        `Google Drive ${response.status}: ${detail.slice(0, 200)}`,
      );
    }
    return response;
  }
  async connect() {
    const bridge = this.bridge();
    if (!bridge) throw new Error("Google authorization is unavailable.");
    await bridge.connect();
    this.enabled = true;
    await this.store.meta("driveEnabled", true);
    return this.sync();
  }
  async sync() {
    if (this.running) return this.running;
    if (!navigator.onLine) {
      this.status("OFFLINE");
      return;
    }
    if (!this.enabled) {
      this.status("SAVED LOCALLY");
      return;
    }
    const work = async () => {
      try {
        this.status("SYNCING");
        await this.store.refresh();
        let seen = new Set((await this.store.meta("driveSeen")) || []);
        let remote = [];
        let pageToken;
        do {
          const url = new URL("https://www.googleapis.com/drive/v3/files");
          url.searchParams.set(
            "q",
            "trashed = false and appProperties has { key='studyPlatform' and value='v1' }",
          );
          url.searchParams.set("fields", "nextPageToken,files(id,name)");
          url.searchParams.set("pageSize", "1000");
          if (pageToken) url.searchParams.set("pageToken", pageToken);
          const page = await (await this.api(url)).json();
          for (const file of page.files || [])
            if (!seen.has(file.id)) {
              const payload = validateBackup(
                await (
                  await this.api(
                    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`,
                  )
                ).json(),
                { partial: true },
              );
              remote.push(...payload.records);
              seen.add(file.id);
            }
          pageToken = page.nextPageToken;
        } while (pageToken);
        // Fold each revision through the merge logic; preserve every concurrent version for user review.
        let merged = this.store.records;
        const conflicts = [];
        for (const r of remote) {
          const result = mergeRecords(merged, [r]);
          merged = result.records;
          conflicts.push(...result.conflicts);
        }
        if (conflicts.length) {
          this.conflicts = conflicts;
          await this.store.meta("driveConflicts", conflicts);
          this.status("CONFLICT DETECTED");
          return;
        }
        validateBackup(makeBackup(merged));
        await this.store.change(
          "Apply Drive revisions",
          (rows) => {
            let latest = rows;
            for (const r of remote) {
              const fold = mergeRecords(latest, [r]);
              if (fold.conflicts.length) {
                this.conflicts = fold.conflicts;
                throw new Error("Concurrent changes require review.");
              }
              latest = fold.records;
            }
            validateBackup(makeBackup(latest));
            return latest;
          },
          { remote: true, undo: false },
        );
        const acknowledged = (await this.store.meta("driveAcknowledged")) || {};
        const changed = this.store.records.filter(
          (r) => JSON.stringify(r.clock) !== acknowledged[r.id],
        );
        if (changed.length) {
          const payload = makeBackup(changed);
          payload.revisionId = id();
          payload.savedAt = now();
          const boundary = "study_" + id();
          const metadata = {
            name: `Study Platform ${payload.savedAt.replace(/[:.]/g, "-")}.json`,
            mimeType: "application/json",
            appProperties: { studyPlatform: "v1" },
          };
          const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(payload)}\r\n--${boundary}--\r\n`;
          const file = await (
            await this.api(
              "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
              {
                method: "POST",
                headers: {
                  "Content-Type": `multipart/related; boundary=${boundary}`,
                },
                body,
              },
            )
          ).json();
          if (!file.id)
            throw new Error("Drive did not confirm the new revision.");
          seen.add(file.id);
          for (const r of changed) acknowledged[r.id] = JSON.stringify(r.clock);
          await this.store.meta("lastStudyDriveFile", file.id);
        }
        await this.store.meta("driveAcknowledged", acknowledged);
        await this.store.meta("driveSeen", [...seen]);
        await this.store.meta("driveLastSync", now());
        await this.store.refresh();
        this.pending = this.store.records.some(
          (r) => JSON.stringify(r.clock) !== acknowledged[r.id],
        );
        this.status(this.pending ? "SAVED LOCALLY" : "SAVED TO GOOGLE DRIVE");
        if (this.pending) this.schedule();
      } catch (e) {
        if (this.conflicts.length) {
          await this.store.meta("driveConflicts", this.conflicts);
          this.status("CONFLICT DETECTED");
          return;
        }
        this.status(
          e.message === "AUTHENTICATION REQUIRED"
            ? "AUTHENTICATION REQUIRED"
            : "SYNC FAILED",
          e.message,
        );
        throw e;
      } finally {
      }
    };
    this.running = (
      globalThis.navigator?.locks
        ? globalThis.navigator.locks.request("studyPlatform.driveSync", work)
        : work()
    ).finally(() => {
      this.running = null;
    });
    return this.running;
  }
  async resolveAll(choices) {
    for (let i = 0; i < this.conflicts.length; i++)
      await this.store.resolve(this.conflicts[i], choices[i] || "local");
    this.conflicts = [];
    await this.store.meta("driveConflicts", []);
    this.pending = true;
    return this.sync();
  }
}
