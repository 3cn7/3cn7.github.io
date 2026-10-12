import test from "node:test";
import assert from "node:assert/strict";
import { DriveSync } from "../assets/sync.js";
import {
  makeBackup,
  createStudySet,
  createFlashcard,
  clone,
} from "../assets/core.js";
import { mergeRecords } from "../assets/persistence.js";
if (!globalThis.CustomEvent)
  globalThis.CustomEvent = class extends Event {
    constructor(type, init = {}) {
      super(type);
      this.detail = init.detail;
    }
  };
class FakeStore extends EventTarget {
  constructor(records) {
    super();
    this.records = records;
    this.values = {};
  }
  async refresh() {}
  async meta(key, value) {
    if (arguments.length === 1) return clone(this.values[key]);
    this.values[key] = clone(value);
  }
  async change(label, fn) {
    this.records = fn(clone(this.records));
  }
  async resolve(conflict, choice) {
    this.records = this.records.map((r) =>
      r.id === conflict.id
        ? {
            ...(choice === "local" ? conflict.local : conflict.remote),
            clock: { ...conflict.local.clock, ...conflict.remote.clock, a: 4 },
          }
        : r,
    );
  }
}
function response(value, status = 200) {
  return {
    ok: status < 400,
    status,
    json: async () => clone(value),
    text: async () =>
      typeof value === "string" ? value : JSON.stringify(value),
  };
}
function fixture() {
  const set = createStudySet({ title: "Sync test", clock: { a: 1 } }),
    card = createFlashcard(set.id, {
      term: "ciao",
      definition: "hello",
      clock: { a: 1 },
    });
  return { set, card };
}
test("Drive revisions retain the established appProperty and upload only JSON records", async () => {
  Object.defineProperty(globalThis, "navigator", {
    value: { onLine: true },
    configurable: true,
  });
  const { set, card } = fixture(),
    store = new FakeStore([set, card]),
    calls = [];
  const sync = new DriveSync(
    store,
    () => ({ token: () => "memory-only-token" }),
    async (url, opts = {}) => {
      calls.push({ url: String(url), opts });
      return response(
        opts.method === "POST" ? { id: "revision-1" } : { files: [] },
      );
    },
  );
  sync.enabled = true;
  await sync.sync();
  assert.equal(sync.state, "SAVED TO GOOGLE DRIVE");
  assert.equal(calls.filter((c) => c.opts.method === "POST").length, 1);
  assert(calls[1].opts.body.includes("studyPlatform"));
  assert(calls[1].opts.headers["Content-Type"].includes("multipart/related"));
  assert.equal(
    store.values.driveAcknowledged[card.id],
    JSON.stringify(card.clock),
  );
});
test("Provider failures never claim success and keep pending data locally", async () => {
  const { set, card } = fixture(),
    store = new FakeStore([set, card]);
  const sync = new DriveSync(
    store,
    () => ({ token: () => "token" }),
    async () => response("Failed", 503),
  );
  sync.enabled = true;
  await assert.rejects(sync.sync());
  assert.equal(sync.state, "SYNC FAILED");
  assert.equal(store.records[1].term, "ciao");
  assert.equal(store.values.driveAcknowledged, undefined);
});
test("Local edits made during upload remain dirty for a subsequent revision", async () => {
  const { set, card } = fixture(),
    store = new FakeStore([set, card]);
  const sync = new DriveSync(
    store,
    () => ({ token: () => "token" }),
    async (url, opts = {}) => {
      if (opts.method === "POST") {
        store.records[1] = {
          ...store.records[1],
          term: "edited during upload",
          clock: { a: 2 },
        };
        return response({ id: "revision" });
      }
      return response({ files: [] });
    },
  );
  sync.enabled = true;
  await sync.sync();
  clearTimeout(sync.timer);
  assert.equal(sync.pending, true);
  assert.equal(sync.state, "SAVED LOCALLY");
  assert.equal(
    store.values.driveAcknowledged[card.id],
    JSON.stringify({ a: 1 }),
  );
  assert.equal(store.records[1].term, "edited during upload");
});
test("Remote edits are merged by clock and conflicting versions are both retained", async () => {
  const { set, card } = fixture(),
    remote = { ...card, term: "remote", clock: { a: 1, b: 1 } },
    store = new FakeStore([set, { ...card, term: "local", clock: { a: 2 } }]);
  const sync = new DriveSync(
    store,
    () => ({ token: () => "token" }),
    async (url) =>
      String(url).includes("alt=media")
        ? response(makeBackup([remote]))
        : response({ files: [{ id: "remote-revision" }] }),
  );
  sync.enabled = true;
  await sync.sync();
  assert.equal(sync.state, "CONFLICT DETECTED");
  assert.equal(sync.conflicts[0].local.term, "local");
  assert.equal(sync.conflicts[0].remote.term, "remote");
  assert.equal(store.records[1].term, "local");
});
test("Unseen remote tombstones remove records and deleted records do not reappear", async () => {
  const { set, card } = fixture(),
    remote = { ...card, deleted: true, clock: { a: 2 } },
    store = new FakeStore([set, card]);
  const sync = new DriveSync(
    store,
    () => ({ token: () => "token" }),
    async (url, opts = {}) =>
      opts.method === "POST"
        ? response({ id: "ack" })
        : String(url).includes("alt=media")
          ? response(makeBackup([remote]))
          : response({ files: [{ id: "deletion" }] }),
  );
  sync.enabled = true;
  await sync.sync();
  assert.equal(store.records[1].deleted, true);
  assert(mergeRecords(store.records, [card]).records[1].deleted);
});
test("Offline synchronization preserves local data without making network calls", async () => {
  Object.defineProperty(globalThis, "navigator", {
    value: { onLine: false },
    configurable: true,
  });
  const { set, card } = fixture(),
    store = new FakeStore([set, card]);
  const sync = new DriveSync(
    store,
    () => ({ token: () => "token" }),
    async () => {
      throw new Error("Network should not be called");
    },
  );
  sync.enabled = true;
  await sync.sync();
  assert.equal(sync.state, "OFFLINE");
  assert.equal(store.records.length, 2);
  Object.defineProperty(globalThis, "navigator", {
    value: { onLine: true },
    configurable: true,
  });
});

test("an expired Drive token is renewed silently before asking the learner to reconnect", async () => {
  const { DriveSync } = await import("../assets/sync.js");
  const calls = [];
  let token = "";
  const bridge = {
    token: () => token,
    silent: async () => ((token = "fresh"), true),
  };
  const fetcher = async (url, init) => (
    calls.push(init.headers.Authorization),
    new Response("{}")
  );
  const sync = new DriveSync(
    { meta: async () => false, addEventListener() {} },
    () => bridge,
    fetcher,
  );
  await sync.api("https://www.googleapis.com/drive/v3/files");
  assert.deepEqual(calls, ["Bearer fresh"]);
  const stuck = new DriveSync(
    { meta: async () => false, addEventListener() {} },
    () => ({ token: () => "", silent: async () => false }),
    fetcher,
  );
  await assert.rejects(stuck.api("https://x"), /AUTHENTICATION REQUIRED/);
});

test("revisions from another device announce themselves, and own revisions do not", async () => {
  const { set, card } = fixture(),
    remote = { ...card, term: "from the other device", clock: { a: 1, b: 1 } },
    store = new FakeStore([set, card]),
    events = [];
  let uploaded = [];
  const sync = new DriveSync(
    store,
    () => ({ token: () => "token" }),
    async (url, init) => {
      if (String(url).includes("alt=media"))
        return response(makeBackup([remote]));
      if (String(url).includes("upload/drive")) {
        uploaded.push(1);
        return response({ id: "own-revision" });
      }
      return response({ files: [{ id: "remote-revision" }] });
    },
  );
  sync.enabled = true;
  sync.addEventListener("incoming", () => events.push("incoming"));
  sync.addEventListener("incomingEnd", (e) =>
    events.push("end:" + e.detail.ok),
  );
  await sync.sync();
  assert.deepEqual(events, ["incoming", "end:true"]);
  assert.equal(store.records[1].term, "from the other device");
  // The same revision again, and the one this device uploaded, are not announced.
  events.length = 0;
  await sync.sync();
  assert.deepEqual(events, []);
  assert(uploaded.length <= 1);
});
test("a failed pull still ends the announcement", async () => {
  const { set, card } = fixture(),
    store = new FakeStore([set, card]),
    events = [];
  const sync = new DriveSync(
    store,
    () => ({ token: () => "token" }),
    async (url) =>
      String(url).includes("alt=media")
        ? response("nope", 500)
        : response({ files: [{ id: "broken" }] }),
  );
  sync.enabled = true;
  sync.addEventListener("incoming", () => events.push("incoming"));
  sync.addEventListener("incomingEnd", () => events.push("end"));
  await assert.rejects(sync.sync());
  assert.deepEqual(events, ["incoming", "end"]);
});
