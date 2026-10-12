// While revisions written by another device are being applied, the screen is held: a solid grey
// cover with a fan of cards (the same card design as the dashboard streak art) and nothing can be
// clicked. It is a modal <dialog>, so it also sits above any dialog that happens to be open.
const MINIMUM_MS = 1400;
const CARDS = [
  ["ciao", "hello"],
  ["grazie", "thank you"],
  ["buongiorno", "good morning"],
];
export function watchIncoming(sync, { done = () => {} } = {}) {
  let dialog = null,
    openedAt = 0,
    closing = null;
  const build = () => {
    const d = document.createElement("dialog");
    d.className = "sync-overlay";
    d.setAttribute("aria-labelledby", "syncTitle");
    d.innerHTML = `<div class="sync-stage" aria-hidden="true">${CARDS.map(
      ([term, meaning], i) =>
        `<div class="sync-card c${i + 1}"><small>ITALIAN</small><strong>${term}</strong><span>${meaning}</span><i>✦</i></div>`,
    ).join(
      "",
    )}</div><h2 id="syncTitle" role="status">Updating from another device</h2><p>Changes saved to Google Drive are being applied. This only takes a moment.</p>`;
    // Escape must not dismiss it; it ends when the work does.
    d.addEventListener("cancel", (e) => e.preventDefault());
    document.body.append(d);
    return d;
  };
  sync.addEventListener("incoming", () => {
    clearTimeout(closing);
    if (!dialog) dialog = build();
    if (!dialog.open) {
      dialog.showModal();
      openedAt = Date.now();
    }
  });
  sync.addEventListener("incomingEnd", (e) => {
    const ok = e.detail?.ok !== false,
      wait = Math.max(0, MINIMUM_MS - (Date.now() - openedAt));
    closing = setTimeout(() => {
      dialog?.close();
      dialog?.remove();
      dialog = null;
      done(ok);
    }, wait);
  });
}
