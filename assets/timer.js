import { esc, options, toast } from "./ui.js";
export const timerValue = (s, at = Date.now()) =>
  Math.max(
    0,
    s.running
      ? s.mode === "countdown"
        ? s.anchor - at
        : s.valueMs + at - s.anchor
      : s.valueMs,
  );
export function transitionTimer(state, action, at = Date.now()) {
  const s = { ...state };
  if (action === "pause") {
    s.valueMs = timerValue(s, at);
    s.running = false;
  }
  if (action === "start") {
    if (s.mode === "countdown" && s.valueMs <= 0) s.valueMs = s.durationMs;
    s.anchor = s.mode === "countdown" ? at + s.valueMs : at;
    s.running = true;
    s.completed = false;
  }
  if (action === "reset") {
    s.running = false;
    s.valueMs = s.mode === "countdown" ? s.durationMs : 0;
    s.anchor = 0;
    s.completed = false;
  }
  return s;
}
export const formatTimer = (ms) => {
  const n = Math.max(0, Math.ceil(ms / 1000));
  return [Math.floor(n / 3600), Math.floor(n / 60) % 60, n % 60]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
};
export function createTimer() {
  const key = "studyPlatform.timer.v2";
  let state;
  try {
    state = JSON.parse(localStorage.getItem(key));
  } catch {}
  state = {
    mode: "countdown",
    durationMs: 1500000,
    valueMs: 1500000,
    anchor: 0,
    running: false,
    visible: false,
    sound: false,
    notify: false,
    completed: false,
    ...state,
  };
  const panel = document.querySelector("#timerPanel"),
    toggle = document.querySelector("#timerToggle");
  let audio = null,
    alertInterval = null;
  const save = () => {
    localStorage.setItem(key, JSON.stringify(state));
  };
  function stopAlert() {
    clearInterval(alertInterval);
    alertInterval = null;
    audio?.close().catch(() => {});
    audio = null;
  }
  function beep() {
    if (!audio || audio.state !== "running") return;
    const oscillator = audio.createOscillator(),
      gain = audio.createGain();
    oscillator.frequency.value = 660;
    gain.gain.setValueAtTime(0.1, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.3);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + 0.3);
  }
  function draw() {
    panel.hidden = !state.visible;
    toggle.setAttribute("aria-expanded", String(state.visible));
    const seconds = Math.round(state.durationMs / 1000);
    panel.innerHTML = `<div class="row between"><strong>Study timer</strong><button id="timerClose" class="icon-btn" aria-label="Collapse timer">−</button></div><output id="timerReadout" class="timer-digits">${formatTimer(timerValue(state))}</output><label>Mode<select id="timerMode" ${state.running ? "disabled" : ""}>${options(
      [
        ["countdown", "Countdown"],
        ["stopwatch", "Stopwatch"],
      ],
      state.mode,
    )}</select></label>${
      state.mode === "countdown"
        ? `<div class="timer-inputs">${[
            ["Hours", "h", Math.floor(seconds / 3600), 99],
            ["Minutes", "m", Math.floor(seconds / 60) % 60, 59],
            ["Seconds", "s", seconds % 60, 59],
          ]
            .map(
              ([label, k, n, max]) =>
                `<label>${label}<input id="timer-${k}" type="number" min="0" max="${max}" value="${n}" ${state.running ? "disabled" : ""}></label>`,
            )
            .join(
              "",
            )}</div><div class="row"><label class="check"><input type="checkbox" id="timerSound" ${state.sound ? "checked" : ""}>Sound</label><label class="check"><input type="checkbox" id="timerNotify" ${state.notify ? "checked" : ""}>Notification</label></div>`
        : ""
    }<div class="row"><button id="timerStart" class="primary">${state.running ? "Pause" : state.completed ? "Restart" : timerValue(state) === (state.mode === "countdown" ? state.durationMs : 0) ? "Start" : "Resume"}</button><button id="timerReset">Reset</button>${state.completed ? '<button id="timerStopAlert">Stop alert</button>' : ""}</div><small id="timerNote">${state.completed ? "Time is up." : state.running ? "Continues through navigation and refresh." : "Ready when you are."}</small>`;
    panel.querySelector("#timerClose").onclick = () => {
      state.visible = false;
      save();
      draw();
    };
    panel.querySelector("#timerStart").onclick = async () => {
      stopAlert();
      if (state.sound && state.mode === "countdown") {
        audio = new AudioContext();
        await audio.resume();
      }
      state = transitionTimer(state, state.running ? "pause" : "start");
      save();
      draw();
    };
    panel.querySelector("#timerReset").onclick = () => {
      stopAlert();
      state = transitionTimer(state, "reset");
      save();
      draw();
    };
    panel.querySelector("#timerMode").onchange = (e) => {
      state.mode = e.target.value;
      state = transitionTimer(state, "reset");
      save();
      draw();
    };
    for (const k of ["h", "m", "s"]) {
      const input = panel.querySelector("#timer-" + k);
      if (input)
        input.onchange = () => {
          const nums = ["h", "m", "s"].map((k) =>
            Math.max(
              0,
              Math.min(
                k === "h" ? 99 : 59,
                Number(panel.querySelector("#timer-" + k).value) || 0,
              ),
            ),
          );
          state.durationMs = (nums[0] * 3600 + nums[1] * 60 + nums[2]) * 1000;
          if (!state.durationMs) {
            toast("Choose a countdown longer than zero.");
            state.durationMs = 1000;
          }
          state = transitionTimer(state, "reset");
          save();
          draw();
        };
    }
    const sound = panel.querySelector("#timerSound");
    if (sound)
      sound.onchange = (e) => {
        state.sound = e.target.checked;
        save();
      };
    const notify = panel.querySelector("#timerNotify");
    if (notify)
      notify.onchange = async (e) => {
        state.notify = e.target.checked;
        if (state.notify) {
          if (!("Notification" in window)) {
            toast("Notifications are not supported here.");
            state.notify = false;
          } else
            state.notify =
              (await Notification.requestPermission()) === "granted";
        }
        save();
        draw();
      };
    panel.querySelector("#timerStopAlert")?.addEventListener("click", () => {
      stopAlert();
      toast("Alert stopped.");
    });
  }
  async function tick() {
    if (
      state.running &&
      state.mode === "countdown" &&
      timerValue(state) === 0
    ) {
      // A shared lock and the persisted completed state let only one open tab announce expiry.
      const finish = () => {
        let current;
        try {
          current = JSON.parse(localStorage.getItem(key));
        } catch {}
        if (!current?.running || current.anchor !== state.anchor) return;
        state = transitionTimer(state, "pause");
        state.completed = true;
        save();
        if (state.sound) {
          beep();
          alertInterval = setInterval(beep, 1800);
          setTimeout(stopAlert, 30000);
        }
        if (state.notify && globalThis.Notification?.permission === "granted")
          new Notification("Study timer finished", {
            body: "Your study interval is complete.",
          });
        toast("Study timer finished.");
        draw();
      };
      if (navigator.locks)
        await navigator.locks.request("studyroom-timer-finish", finish);
      else finish();
    }
    const value = formatTimer(timerValue(state));
    document.querySelector("#timerMini").textContent =
      state.running || state.completed ? value : "Timer";
    const output = panel.querySelector("#timerReadout");
    if (output) output.textContent = value;
  }
  toggle.onclick = () => {
    state.visible = !state.visible;
    save();
    draw();
  };
  window.addEventListener("storage", (e) => {
    if (e.key === key && e.newValue) {
      state = JSON.parse(e.newValue);
      stopAlert();
      draw();
      tick();
    }
  });
  document.addEventListener("visibilitychange", tick);
  draw();
  tick();
  const interval = setInterval(tick, 250);
  return {
    stop() {
      clearInterval(interval);
      stopAlert();
    },
  };
}
