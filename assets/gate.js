// A padlock for the site. It asks for a password once per browser. Anyone who has already used
// the site in this browser (they have a device ID from an earlier visit) is let in without it, and
// so is everyone after a correct password.
//
// This is a deterrent, not real security: the site is static files, so the check runs in the
// visitor's browser and the code is public. Only a salted PBKDF2 hash is stored here, not the password.
const SALT = "6bcb6f540d176b25aa6346739b5fe742",
  HASH = "8a3573c8699402338b9d19c08bda1561f8e36c1700f8b4d1bc9ff226343df367",
  ITERATIONS = 310000,
  ACCESS_KEY = "studyPlatform.access";
const hex = (buffer) =>
  [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
async function matches(password) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: ITERATIONS,
      salt: Uint8Array.from(SALT.match(/../g).map((h) => parseInt(h, 16))),
    },
    key,
    256,
  );
  return hex(bits) === HASH;
}
// Automated test browsers skip the lock unless the address has ?gate=on.
const skipped = () =>
  navigator.webdriver && !location.search.includes("gate=on");
export const isUnlocked = () => {
  try {
    return (
      skipped() ||
      localStorage.getItem(ACCESS_KEY) === "granted" ||
      !!localStorage.getItem("studyPlatform.device")
    );
  } catch {
    return false;
  }
};
export async function unlockSite() {
  if (isUnlocked()) {
    try {
      localStorage.setItem(ACCESS_KEY, "granted");
    } catch {}
    document.documentElement.classList.remove("locked");
    return;
  }
  document.documentElement.classList.add("locked");
  const screen = document.createElement("div");
  screen.className = "lock-screen";
  screen.setAttribute("role", "dialog");
  screen.setAttribute("aria-modal", "true");
  screen.setAttribute("aria-labelledby", "lockTitle");
  screen.innerHTML = `<form class="lock-card" autocomplete="off"><div class="lock-icon" aria-hidden="true">🔒</div><h1 id="lockTitle">Studyroom is private</h1><p>Enter the password to continue. You'll only be asked once on this device.</p><label>Password<input id="lockPassword" type="password" autocomplete="current-password" required></label><p id="lockError" class="lock-error" role="alert" hidden></p><button class="primary" type="submit">Unlock</button></form>`;
  document.body.append(screen);
  const input = screen.querySelector("#lockPassword"),
    error = screen.querySelector("#lockError");
  input.focus();
  await new Promise((resolve) => {
    let failures = 0;
    screen.querySelector("form").onsubmit = async (e) => {
      e.preventDefault();
      const submit = e.submitter;
      submit.disabled = true;
      error.hidden = true;
      try {
        if (!crypto?.subtle)
          throw new Error("This page must be opened over HTTPS to unlock.");
        if (await matches(input.value)) {
          try {
            localStorage.setItem(ACCESS_KEY, "granted");
          } catch {}
          return resolve();
        }
        failures++;
        error.textContent = "That password is not right.";
        // Each wrong guess waits a little longer.
        await new Promise((r) => setTimeout(r, Math.min(5000, failures * 800)));
      } catch (problem) {
        error.textContent = problem.message;
      }
      error.hidden = false;
      submit.disabled = false;
      input.select();
    };
  });
  screen.remove();
  document.documentElement.classList.remove("locked");
}
