// Buttons for the Italian letters that are awkward to type, usable in any text answer or card field.
const LOWER = ["à", "è", "é", "ì", "ò", "ó", "ù"];
let lastField = null;
/** `target` is a CSS selector for the field to fill; empty means the field that was focused last. */
export const accentBar = (target = "", label = "Italian letters") =>
  `<div class="accent-bar" role="group" aria-label="${label}"><span class="accent-label" aria-hidden="true">Insert</span>${LOWER.map((c) => `<button type="button" class="accent-key" data-insert="${c}" data-target="${target}" aria-label="Insert ${c}">${c}</button>`).join("")}<button type="button" class="accent-key accent-shift" data-shift aria-pressed="false" aria-label="Capital letters">⇧</button></div>`;
/** Whether a typed answer in this language may need accents. */
export const needsAccents = (language, answer = "") =>
  /^it/i.test(language || "") || /[àèéìíîòóùúÀÈÉÌÒÙ]/.test(answer);
export function bindAccents() {
  if (bindAccents.done) return;
  bindAccents.done = true;
  document.addEventListener("focusin", (e) => {
    if (
      e.target.matches?.("input[type=text],input:not([type]),textarea") &&
      !e.target.closest(".accent-bar")
    )
      lastField = e.target;
  });
  // Keep the caret in the field while a letter button is pressed.
  document.addEventListener("mousedown", (e) => {
    if (e.target.closest?.(".accent-key")) e.preventDefault();
  });
  document.addEventListener("click", (e) => {
    const key = e.target.closest?.(".accent-key");
    if (!key) return;
    const bar = key.closest(".accent-bar");
    if (key.hasAttribute("data-shift")) {
      const on = key.getAttribute("aria-pressed") !== "true";
      key.setAttribute("aria-pressed", String(on));
      bar.querySelectorAll("[data-insert]").forEach((b) => {
        const c = on
          ? b.dataset.insert.toUpperCase()
          : b.dataset.insert.toLowerCase();
        b.dataset.insert = c;
        b.textContent = c;
        b.setAttribute("aria-label", "Insert " + c);
      });
      return;
    }
    const field =
      (key.dataset.target && document.querySelector(key.dataset.target)) ||
      (lastField?.isConnected ? lastField : null);
    if (!field || field.disabled) return;
    const at = field.selectionStart ?? field.value.length,
      end = field.selectionEnd ?? at;
    field.setRangeText(key.dataset.insert, at, end, "end");
    field.focus();
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
