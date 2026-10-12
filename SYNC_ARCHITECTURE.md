# Persistence, migration and Google Drive

The existing `studyPlatform.v1` IndexedDB stores are retained: records, meta, and audio. IDs, clocks, stars, folders, directional mastery, sessions, tests and transcript source links are unchanged. The wire schema remains version 1 to preserve existing Drive revisions; the feature migration is version 2 and adds optional transcript fields.

## Migration

Before new features initialize, an atomic records/meta transaction validates and saves all current study records and a snapshot of prior localStorage in `beforeStudyOnlyMigration`. No historical localStorage keys are removed and no database is cleared. Shared OAuth client ID and countdown preference shapes are copied into independent study preferences. Old Drive file IDs are never adopted.

Settings can download this local backup or merge its earlier study records. Restore validates relationships and retains newer/concurrent changes for review. The snapshot is local metadata, so retired feature data and credentials are not uploaded by Drive. Recordings remain in their original audio store. Source rollback is possible through checkpoint `99f69a0`; export the migration backup before rolling back. The implementation did not inspect the user's personal browser profile: backup happens on the site's first updated launch in that origin.

## Authorization

`assets/google-auth.js` loads Google Identity Services only on Connect, uses `drive.file`, and keeps its access token and expiry only in memory. Client ID is a nonsecret local preference. Enable the Drive API, create a Web OAuth client and register https://3cn7.github.io plus any localhost origin used for testing. Refresh or expired authorization requires reconnecting. [Google token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model).

## Revisions

The retained Drive adapter lists only files with appProperty `studyPlatform=v1`. It validates unseen immutable JSON revisions, merges records by vector clocks, and uploads changed record clocks in a separate immutable revision. Local writes debounce for five seconds; manual Save Now and periodic remote checks remain. Upload acknowledgments use the exact uploaded clocks, so edits made during upload stay pending. A browser lock coordinates tabs. Concurrent changes and tombstones are preserved for review.

The adapter never uploads raw audio, live chunks, downloaded models or local backup metadata. It has no inference endpoint, and never modifies or deletes any historical remote tracker file. Saved transcript text, translations and preferences can be synchronized as ordinary records. Microphone and translation processing require no Google authorization.
