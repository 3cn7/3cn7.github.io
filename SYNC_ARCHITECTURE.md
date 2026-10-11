# Persistence and synchronization

## Preserved SAT behavior

The original SAT script inside `sat.html` is unchanged. It uses:

- `satQuestionBankTracker.v4`: local SAT sections and question records.
- `satMathQuestionTracker.v3`: existing Math migration source.
- `satQuestionBankTracker.settings.v1`, timer and Drive configuration keys: original preferences.
- Original `SAT Question Bank Tracker Data.json`, app property `satQuestionBankTracker=v1`, schemaVersion 1 and tracker.version 4.
- Existing Google Identity token client, `drive.file` scope, debounced uploads, manual save, revision/hash comparisons, conflict dialog, and upload-race detection.

The platform embeds this active tracker at the same origin. `SATBridge` gives the platform access to its in-memory OAuth token, connection action, settings action, and a cloned summary. Tokens are never persisted, sent with postMessage, or included in backups. The original SAT file is never addressed by the new study adapter. Original SAT conflict resolution stays in its original settings UI.

No existing local or cloud SAT data was migrated or rewritten to accommodate the study schema. The archived original script's hash is checked in regression tests.

## New local schema

IndexedDB `studyPlatform.v1` has `records`, `meta`, and `audio` stores. Typed records include sets, cards, folders, learning, attempts, sessions, tests, transcripts, and preferences. Audio is a Blob in a separate store, never JSON Base64. Meta contains local companion URLs, sync checkpoints, draft suggestions, and restoration backups. Companion access tokens live only in the current tab's memory.

Each synced record has a stable ID, timestamps, a causal vector `clock`, and a deletion marker. Local writes increment the device component inside a serial IndexedDB readwrite transaction. Stale whole-record saves are rejected. Field updates read the latest database record inside the transaction. BroadcastChannel refreshes other tabs. Undo retains changed records and creation IDs; it blocks when a newer tab/device revision would be overwritten.

Card keystrokes and transcript text have synchronous recovery journals in localStorage before their asynchronous database save. Backup restoration validates records and retains a `beforeRestore` copy before merging. Unsupported schema versions are rejected; there is currently no earlier study schema to migrate. SAT's existing migration stays untouched.

## Drive revisions

New study data uses **immutable delta revision files** with `appProperties.studyPlatform=v1`. Each successful upload creates a new JSON file containing records changed since acknowledgement. It never overwrites another device's upload. This avoids the last-writer race of two devices PATCHing one mutable library JSON file. Each payload is schemaVersion 1, `app: Study Platform`, with a revision UUID. The first upload includes all local records.

Synchronization lists these files, downloads unseen revisions, merges causal versions, then uploads unacknowledged records. Pagination is supported. Missing set/card references are permitted inside a delta but the reconstructed full database is validated before applying it. Full local merge happens inside the write transaction to protect edits made while files were downloading. After the confirmed upload, only the exact uploaded clocks are acknowledged. Newer edits stay pending and trigger another cycle. Same-origin tab sync loops are serialized through Web Locks where supported.

Autosync is debounced five seconds after edits and checks remote changes about once per minute while the app is open. Manual Save Now is available. Offline/local-only mode preserves all database records. A failed response never produces a saved-to-Drive status. OAuth reconnect uses the existing tracker, with no broader permission scope.

## Conflicts and deletion

Causally newer records replace older versions; different IDs merge. Concurrent edits to the same content preserve both versions in a local conflict record and stop uploading until the user chooses a copy. Choosing a copy joins both clocks before a new local revision, so old revisions cannot win later. Exported backups are available before conflict resolution.

Deleted records retain tombstones. Older device revisions cannot resurrect them. Recently Deleted can restore content. Permanent erase clears record content while retaining a marker; it does **not** erase earlier immutable Drive revisions or historical test snapshots. If the user needs cloud erasure, they must explicitly remove the corresponding Drive files. Nothing deletes remote backups automatically.

## Audio

Audio retention is explicit: keep locally, keep locally plus upload to Drive, or delete local audio after successful transcription. Drive audio uses a separate resumable upload and stores only its file ID in transcript metadata. Failed audio uploads retain the local Blob and transcript. A different device can open/download the referenced Drive audio; automatic audio redownload into IndexedDB is not implemented.

## Operational limits and verification

Immutable deltas prioritize avoiding lost updates. They accumulate over time and may make a first synchronization on a new device slower. Automatic compaction is not implemented, because deleting revisions prematurely could discard another device's unmerged data. The library JSON excludes audio but long history still grows; keep periodic full backups.

Automated tests mock Drive listing/downloading/uploads, failures, deletions, conflicts, and edits during upload. No actual Google login or Drive upload was performed without the user's configured credentials. Manual integration: sign in, save new material, edit offline, reconnect, verify on another device, then edit the same card on both devices and verify the conflict screen. Also verify the original SAT file continues syncing in its original format.
