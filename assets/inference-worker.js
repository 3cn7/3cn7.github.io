import { pipeline, env, Tensor } from "../vendor/transformers.web.js";
import { MODELS, MODEL_CACHE } from "./models.js";
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.useBrowserCache = false;
env.useFSCache = false;
env.useCustomCache = true;
env.customCache = {
  match: async (key) => (await caches.open(MODEL_CACHE)).match(key),
  put: async () => {
    throw new Error("Install models from the model manager.");
  },
};
env.backends.onnx.wasm.wasmPaths = new URL("../vendor/", import.meta.url).href;
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;
let active = null,
  key = null,
  device = null,
  requested = null,
  verified = false;
const unreliableGPU = new Set();
const create = (model, device) =>
  pipeline(model.task, model.id, {
    revision: model.revision,
    device,
    dtype: "q8",
    local_files_only: true,
  });
async function load(next, preferred) {
  if (active && key === next && requested === preferred) return active;
  if (active) {
    await active.dispose();
    active = null;
  }
  const model = MODELS.find((m) => m.key === next);
  if (!model) throw new Error("Unknown local model.");
  let gpu = false;
  try {
    gpu =
      preferred !== "wasm" &&
      !unreliableGPU.has(next) &&
      !!(await navigator.gpu?.requestAdapter());
  } catch {}
  if (gpu) {
    try {
      active = await create(model, "webgpu");
      device = "webgpu";
    } catch (e) {
      postMessage({
        event: "fallback",
        message: "WebGPU could not run this model; using WebAssembly.",
        detail: e.message,
      });
      active = await create(model, "wasm");
      device = "wasm";
    }
  } else {
    active = await create(model, "wasm");
    device = "wasm";
  }
  key = next;
  requested = preferred;
  verified = device === "wasm";
  return active;
}
async function dispose(value) {
  if (value?.dispose) await value.dispose();
  else if (value && typeof value === "object")
    for (const child of Object.values(value)) await dispose(child);
}
async function recognize(pipe, data) {
  let language = data.language;
  if (!["en", "it"].includes(language)) {
    // The pinned library otherwise defaults to English. Compare Whisper's actual
    // first decoder language logits for the user's primary languages on each chunk.
    const features = await pipe.processor(data.samples),
      start = pipe.model.generation_config.decoder_start_token_id;
    const first = await pipe.model({
      ...features,
      decoder_input_ids: new Tensor(
        "int64",
        BigInt64Array.from([BigInt(start)]),
        [1, 1],
      ),
    });
    const tokens = pipe.model.generation_config.lang_to_id,
      logits = first.logits.data;
    language = ["en", "it"].reduce(
      (best, next) =>
        logits[tokens["<|" + next + "|>"]] > logits[tokens["<|" + best + "|>"]]
          ? next
          : best,
      "en",
    );
    await dispose(first);
    await features.input_features.dispose?.();
  }
  const out = await pipe(data.samples, {
    language: language === "it" ? "italian" : "english",
    task: "transcribe",
    return_timestamps: true,
    max_new_tokens: 224,
  });
  return { ...out, language };
}
async function infer(pipe, data) {
  if (data.action === "transcribe") return recognize(pipe, data);
  const out = await pipe(data.text, { max_new_tokens: 256 });
  return { text: out[0].translation_text };
}
const normalize = (s) =>
  s.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue
    .catch(() => {})
    .then(async () => {
      try {
        await load(data.key, data.device);
        if (data.action === "load") {
          postMessage({ id: data.id, result: { device, key } });
          return;
        }
        if (data.action === "transcribe") {
          let energy = 0;
          for (const v of data.samples) energy += v * v;
          if (Math.sqrt(energy / data.samples.length) < 0.002) {
            postMessage({
              id: data.id,
              result: { text: "", language: null, device },
            });
            return;
          }
        }
        let result;
        if (device === "webgpu" && !verified) {
          // Some drivers accept q8 graphs but produce incorrect results without an error.
          // Verify the first actual result against the same local WASM model before saving it.
          postMessage({
            event: "verifying",
            message: "Checking WebGPU output against local WebAssembly…",
          });
          const reference = await create(
            MODELS.find((m) => m.key === key),
            "wasm",
          );
          const expected = await infer(reference, data);
          let gpuResult;
          try {
            gpuResult = await infer(active, data);
          } catch {}
          if (
            gpuResult &&
            normalize(gpuResult.text) === normalize(expected.text) &&
            gpuResult.language === expected.language
          ) {
            await reference.dispose();
            verified = true;
            result = gpuResult;
          } else {
            await active.dispose();
            active = reference;
            device = "wasm";
            verified = true;
            unreliableGPU.add(key);
            result = expected;
            postMessage({
              event: "fallback",
              message:
                "WebGPU output did not pass local verification. Using WebAssembly.",
              detail:
                "The first model result differed from the local CPU reference.",
            });
          }
        } else result = await infer(active, data);
        postMessage({ id: data.id, result: { ...result, device } });
      } catch (e) {
        postMessage({ id: data.id, error: e.message || String(e) });
      }
    });
};
