import { createRequire } from "node:module";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.STUDY_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.STUDY_CHROME_PATH,
});
try {
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:8765/#transcripts");
  await page.waitForSelector("#audioInput", { state: "attached" });
  await page.locator("h1").click();
  for (const extension of ["wav", "mp3", "m4a", "mp4", "webm"]) {
    console.log("Checking codec:", extension);
    await page
      .locator("#audioInput")
      .setInputFiles(resolve("tests/fixtures/english." + extension));
    const data = await page.evaluate(async () => {
      const { audioDuration, decodeAudio } = await import("./assets/audio.js");
      const file = document.querySelector("#audioInput").files[0];
      const seconds = await audioDuration(file);
      const samples = await decodeAudio(file);
      let energy = 0;
      for (const n of samples) energy += n * n;
      return {
        seconds,
        samples: samples.length,
        rms: Math.sqrt(energy / samples.length),
      };
    });
    assert(data.seconds > 4 && data.seconds < 12, extension + " duration");
    assert(
      Math.abs(data.samples / 16000 - data.seconds) < 0.3,
      extension + " resampled duration",
    );
    assert(data.rms > 0.01, extension + " speech signal");
    console.log("Decoded locally:", extension, data);
  }
} finally {
  await browser.close();
}
