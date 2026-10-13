// While Google Drive is being synced, the screen is held: a solid grey cover with a fan of cards
// (the card design of the dashboard streak art) and nothing can be clicked. It is a modal <dialog>,
// so it also sits above any dialog that happens to be open.
//   - on opening the site with Drive sync on, until the first sync has finished;
//   - whenever a check finds revisions written by another device.
const MINIMUM_MS = 900;
const CARDS = [
  ["ciao", "hello"],
  ["grazie", "thank you"],
  ["buongiorno", "good morning"],
];
export function createSyncOverlay({ done = () => {} } = {}) {
  let dialog = null,
    openedAt = 0,
    closing = null;
  const build = (detail) => {
    const d = document.createElement("dialog");
    d.className = "sync-overlay";
    d.setAttribute("aria-labelledby", "syncTitle");
    d.innerHTML = `<div class="sync-stage" aria-hidden="true">${CARDS.map(
      ([term, meaning], i) =>
        `<div class="sync-card c${i + 1}"><small>ITALIAN</small><strong>${term}</strong><span>${meaning}</span><i>✦</i></div>`,
    ).join(
      "",
    )}</div><h2 id="syncTitle" role="status">Syncing</h2><p>${detail}</p>`;
    // Escape must not dismiss it; it ends when the work does.
    d.addEventListener("cancel", (e) => e.preventDefault());
    document.body.append(d);
    return d;
  };
  return {
    get open() {
      return !!dialog;
    },
    show(detail = "Applying changes saved by another device.") {
      clearTimeout(closing);
      if (!dialog) dialog = build(detail);
      if (!dialog.open) {
        dialog.showModal();
        openedAt = Date.now();
      }
    },
    /** Ends it after the minimum time. `announce` tells the page something was updated. */
    hide(ok = true, announce = true) {
      if (!dialog) return;
      clearTimeout(closing);
      const wait = Math.max(0, MINIMUM_MS - (Date.now() - openedAt));
      closing = setTimeout(() => {
        dialog?.close();
        dialog?.remove();
        dialog = null;
        if (announce) done(ok);
      }, wait);
    },
  };
}
export function watchIncoming(sync, options) {
  const overlay = createSyncOverlay(options);
  sync.addEventListener("incoming", () => overlay.show());
  sync.addEventListener("incomingEnd", (e) =>
    overlay.hide(e.detail?.ok !== false, true),
  );
  return overlay;
}
