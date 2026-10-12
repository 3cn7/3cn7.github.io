import { spawn } from "node:child_process";
// Isolated browser suites run serially. Model inference is a separate opt-in test.
const checks = [
  "browser-smoke.mjs",
  "browser-data.mjs",
  "browser-learn.mjs",
  "browser-design.mjs",
  "browser-layout.mjs",
  "browser-transcript-local.mjs",
  "browser-codecs.mjs",
  "browser-library.mjs",
  "browser-file-manager.mjs",
  "browser-continue.mjs",
  "browser-transcript-sort.mjs",
  "browser-library-root.mjs",
  "browser-transcript-trash.mjs",
  "browser-stats-back.mjs",
  "browser-learn-retries.mjs",
  "browser-learn-rounds.mjs",
  "browser-folder-click.mjs",
  "browser-transcript-folders.mjs",
  "browser-card-click.mjs",
  "browser-delete-selected.mjs",
  "browser-study-state.mjs",
  "browser-interface.mjs",
  "browser-model-recovery.mjs",
];
for (const name of checks) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["tests/" + name], {
      stdio: "inherit",
      env: process.env,
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(name + " failed with exit " + code)),
    );
  });
  console.log("PASS " + name);
}
