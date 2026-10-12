import {
  mkdir,
  rm,
  copyFile,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
const root = resolve(import.meta.dirname, ".."),
  dist = join(root, "dist"),
  require = createRequire(import.meta.url);
for (const folder of ["assets", "scripts"])
  for (const name of await readdir(join(root, folder))) {
    if (/\.(js|mjs)$/.test(name)) {
      const result = spawnSync(
        process.execPath,
        ["--check", join(root, folder, name)],
        { encoding: "utf8" },
      );
      if (result.status !== 0) throw new Error(result.stderr);
    }
  }
await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, "assets"), { recursive: true });
await mkdir(join(dist, "vendor"), { recursive: true });
for (const name of ["index.html", "sw.js"])
  await copyFile(join(root, name), join(dist, name));
for (const name of await readdir(join(root, "assets"))) {
  if (!/\.(js|css|svg)$/.test(name))
    throw new Error("Unexpected public asset " + name);
  await copyFile(join(root, "assets", name), join(dist, "assets", name));
}
const vendor = resolve(require.resolve("@huggingface/transformers"), "..");
for (const [input, output] of [
  ["transformers.min.js", "transformers.web.js"],
  ["ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.mjs"],
  ["ort-wasm-simd-threaded.jsep.wasm", "ort-wasm-simd-threaded.jsep.wasm"],
])
  await copyFile(join(vendor, input), join(dist, "vendor", output));
await copyFile(
  join(vendor, "..", "LICENSE"),
  join(dist, "vendor", "TRANSFORMERS-LICENSE.txt"),
);
for (const name of await readdir(join(root, "licenses")))
  await copyFile(join(root, "licenses", name), join(dist, "vendor", name));
await writeFile(join(dist, ".nojekyll"), "");
const publicFiles = [
  "index.html",
  ...(await readdir(join(root, "assets"))).map((f) => "assets/" + f),
  "vendor/transformers.web.js",
  "vendor/ort-wasm-simd-threaded.jsep.mjs",
  "vendor/ort-wasm-simd-threaded.jsep.wasm",
];
const hash = createHash("sha256");
for (const file of publicFiles) hash.update(await readFile(join(dist, file)));
const sw = await readFile(join(dist, "sw.js"), "utf8");
await writeFile(
  join(dist, "sw.js"),
  sw
    .replace(
      "__PUBLIC_FILES__",
      JSON.stringify(publicFiles.filter((f) => !f.startsWith("vendor/"))),
    )
    .replace("__BUILD_VERSION__", hash.digest("hex").slice(0, 16)),
);
console.log(
  "Static study app built. Archives, backend code, tests, and local data are excluded.",
);
