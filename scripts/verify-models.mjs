// Network check for assets/models.js: every pinned file must resolve at its pinned revision,
// have the byte length the app expects, and be readable by a cross-origin browser page.
// Run manually (it needs internet access): node scripts/verify-models.mjs [origin]
import { MODELS, modelURL } from "../assets/models.js";
const origin = process.argv[2] || "https://3cn7.github.io";
let failures = 0;
const report = (ok, text) => {
  if (!ok) failures++;
  console.log((ok ? "ok    " : "FAIL  ") + text);
};
for (const model of MODELS) {
  let total = 0;
  for (const file of model.files) {
    const url = modelURL(model, file.path);
    try {
      // A one-byte Range request keeps this cheap and also proves ranged resume works.
      const response = await fetch(url, {
        headers: { Origin: origin, Range: "bytes=0-0" },
        redirect: "follow",
      });
      const range = /\/(\d+)$/.exec(
        response.headers.get("content-range") || "",
      );
      const size = range
        ? Number(range[1])
        : Number(response.headers.get("content-length"));
      const cors = response.headers.get("access-control-allow-origin");
      await response.body?.cancel();
      const corsOk = cors === "*" || cors === origin;
      report(
        (response.status === 200 || response.status === 206) &&
          size === file.bytes &&
          corsOk,
        `${model.key} ${file.path} · HTTP ${response.status} · ${size} bytes (manifest ${file.bytes}) · CORS ${cors}`,
      );
      total += file.bytes;
    } catch (error) {
      report(false, `${model.key} ${file.path} · ${error.message}`);
    }
  }
  report(
    total === model.bytes,
    `${model.key} total ${total} = manifest ${model.bytes}`,
  );
}
if (failures) {
  console.error(failures + " check(s) failed.");
  process.exit(1);
}
console.log(
  "All pinned model files are reachable, complete, and CORS-readable.",
);
