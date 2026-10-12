const CACHE = "studyroom-ui-__BUILD_VERSION__";
const FILES = __PUBLIC_FILES__;
self.addEventListener("install", (event) =>
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(FILES))
      .then(() => self.skipWaiting()),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (k) =>
                k.startsWith("studyroom-ui-") || k.startsWith("studyroom-v1-"),
            )
            .filter((k) => k !== CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin) return;
  const path =
    url.pathname.slice(new URL(self.registration.scope).pathname.length) ||
    "index.html";
  if (
    [
      "vendor/transformers.web.js",
      "vendor/ort-wasm-simd-threaded.jsep.mjs",
      "vendor/ort-wasm-simd-threaded.jsep.wasm",
    ].includes(path)
  ) {
    event.respondWith(
      caches
        .open("studyroom-runtime-v2")
        .then((cache) => cache.match(event.request))
        .then((hit) => hit || fetch(event.request)),
    );
    return;
  }
  if (!FILES.includes(path)) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok)
          caches
            .open(CACHE)
            .then((cache) => cache.put(event.request, response.clone()));
        return response;
      })
      .catch(() =>
        caches
          .open(CACHE)
          .then((cache) => cache.match(new URL(path, self.registration.scope))),
      ),
  );
});
