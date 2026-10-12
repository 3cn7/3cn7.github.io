// A greeting for the dashboard that follows the time of day in the chosen time zone and changes every hour.
const POOLS = {
  morning: [
    "Good morning",
    "Buongiorno!",
    "Rise and shine, scholar",
    "Morning! Fresh mind, fresh words",
    "A bright morning to learn something new",
    "Good morning. Coffee and vocabulary?",
  ],
  afternoon: [
    "Good afternoon",
    "Buon pomeriggio!",
    "Afternoon focus time",
    "Keep the afternoon momentum going",
    "A perfect afternoon for a few new words",
    "Good afternoon. One more round?",
  ],
  evening: [
    "Good evening",
    "Buonasera!",
    "Evening study session, let's go",
    "Winding down? A quick review helps it stick",
    "A good evening to practice",
    "Good evening. Your words are waiting",
  ],
  night: [
    "Good night, night owl",
    "Buonanotte! One last review?",
    "Late-night learning. Nice",
    "Burning the midnight oil",
    "A quiet night for studying",
    "Night owl mode: on",
  ],
};
export const TIME_ZONE_KEY = "studyPlatform.timeZone";
/** The chosen IANA time zone, or the device's own when none (or an invalid one) is saved. */
export function timeZone() {
  let saved = "";
  try {
    saved = localStorage.getItem(TIME_ZONE_KEY) || "";
  } catch {}
  try {
    if (saved) new Intl.DateTimeFormat("en", { timeZone: saved });
    else saved = "";
  } catch {
    saved = "";
  }
  return saved || Intl.DateTimeFormat().resolvedOptions().timeZone;
}
export const periodOf = (hour) =>
  hour >= 5 && hour < 12
    ? "morning"
    : hour < 17 && hour >= 12
      ? "afternoon"
      : hour >= 17 && hour < 22
        ? "evening"
        : "night";
/** Which part of the day it is, and the hour's stamp, in a time zone. */
export function clockIn(zone, at = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((p) => [p.type, Number(p.value)]),
  );
  return {
    hour: parts.hour % 24,
    stamp: `${parts.year}-${parts.month}-${parts.day}-${parts.hour}`,
  };
}
const hashOf = (text) => {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0;
  return h;
};
/** The same greeting all through one hour, a different one the next. */
export function greeting(zone = timeZone(), at = new Date()) {
  const { hour, stamp } = clockIn(zone, at),
    period = periodOf(hour),
    pool = POOLS[period];
  return { period, text: pool[hashOf(zone + stamp) % pool.length] };
}
export const zoneChoices = () =>
  typeof Intl.supportedValuesOf === "function"
    ? Intl.supportedValuesOf("timeZone")
    : [Intl.DateTimeFormat().resolvedOptions().timeZone];
