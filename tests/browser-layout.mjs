import { createRequire } from "node:module";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url),
  { chromium } = require(process.env.STUDY_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.STUDY_CHROME_PATH || undefined,
  }),
  page = await browser.newPage({ viewport: { width: 1440, height: 1050 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto("http://127.0.0.1:8765/");
  await page.waitForSelector("h1");
  const ids = await page.evaluate(async () => {
    const { Store } = await import("./assets/persistence.js"),
      { record, createStudySet, createFlashcard } = await import(
        "./assets/core.js"
      ),
      e = await import("./assets/engine.js"),
      s = await new Store().open();
    const folder = record("folder", {
        name: "Italiano · società e storia",
        parentId: null,
      }),
      set = createStudySet({
        title: "Italiano · società e storia · Long content specimen",
        folderId: folder.id,
        pinned: true,
        lastStudiedAt: new Date().toISOString(),
      }),
      cards = Array.from({ length: 3 }, (_, i) =>
        createFlashcard(
          set.id,
          {
            term:
              i === 0 ? "la città " + "lunghissimo".repeat(30) : "term " + i,
            definition:
              "Una definizione con accenti, apostrofi e Unicode: città, società, perché. ".repeat(
                i === 0 ? 25 : 2,
              ),
            starred: i === 1,
          },
          i,
        ),
      );
    const flash = e.createFlashcardSession(cards, {
        ...e.DEFAULT_STUDY,
        shuffle: false,
      }),
      learn = e.createLearnSession(cards, [], {
        ...e.DEFAULT_STUDY,
        types: ["written"],
      });
    learn.current = e.selectNextQuestion(learn, cards);
    const test = e.createTest(cards, {
        ...e.DEFAULT_STUDY,
        types: ["written"],
        questionCount: 3,
      }),
      transcript = record("transcript", {
        title: "Una lezione",
        rawText: "Oggi parleremo della Sicilia.",
        editedText: "Oggi parleremo della Sicilia.",
        segments: [
          {
            id: "layout-segment",
            start: 0,
            end: 8,
            text: "Oggi parleremo della Sicilia. ".repeat(50),
            originalText: "Oggi parleremo della Sicilia.",
            sourceLanguage: "it",
            targetLanguage: "en",
            translatedText: "Today we will talk about Sicily. ".repeat(50),
            translationStatus: "done",
          },
        ],
      });
    await s.putMany([folder, set, ...cards, flash, learn, test, transcript]);
    return {
      set: set.id,
      folder: folder.id,
      flash: flash.id,
      learn: learn.id,
      test: test.id,
      transcript: transcript.id,
    };
  });
  const routes = [
    "dashboard",
    "library",
    "folder/" + ids.folder,
    "set/" + ids.set,
    "study/" + ids.flash,
    "study/" + ids.learn,
    "test/" + ids.test,
    "transcripts/" + ids.transcript,
    "statistics",
    "settings",
    "sync",
  ];
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => {
      localStorage.setItem("studyPlatform.theme", theme);
      document.documentElement.dataset.theme = theme;
    }, theme);
    for (const width of [360, 390, 768, 1024, 1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1050 });
      for (const route of routes) {
        await page.goto("http://127.0.0.1:8765/#" + route);
        await page.waitForSelector("h1");
        await page.waitForTimeout(30);
        const bad = await page.evaluate(() => {
          const over = document.documentElement.scrollWidth > innerWidth;
          return {
            over,
            bad: [
              ...document.querySelectorAll(
                "#view button,#view input,#view select,#view textarea",
              ),
            ]
              .filter(
                (el) =>
                  el.getClientRects().length &&
                  !el.closest("details:not([open])"),
              )
              .map((el) => ({
                text: el.getAttribute("aria-label") || el.textContent,
                r: el.getBoundingClientRect(),
              }))
              .filter(({ r }) => r.left < 0 || r.right > innerWidth + 1)
              .map(({ text }) => text),
          };
        });
        assert(
          !bad.over && bad.bad.length === 0,
          theme + " " + width + " " + route + " " + JSON.stringify(bad),
        );
      }
      console.log("Populated layout passed", theme, width);
    }
  }
  // Match CSS viewport size and DPR at desktop zoom factors for reflow checks.
  const cdp = await page.context().newCDPSession(page);
  for (const zoom of [1, 1.25, 1.5, 2]) {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: Math.floor(1440 / zoom),
      height: Math.floor(1050 / zoom),
      deviceScaleFactor: zoom,
      mobile: false,
    });
    for (const route of routes) {
      await page.goto("http://127.0.0.1:8765/#" + route);
      await page.waitForSelector("h1");
      assert(
        !(await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        )),
        "Zoom " + zoom + " " + route,
      );
    }
    console.log("Zoom reflow passed", zoom);
  }
  await cdp.send("Emulation.clearDeviceMetricsOverride");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://127.0.0.1:8765/#set/" + ids.set);
  await page.getByRole("button", { name: "Learn", exact: true }).click();
  await page
    .locator("#modal .advanced-study")
    .evaluate((el) => (el.open = true));
  const bounds = await page.locator("#modal").boundingBox();
  assert(
    bounds.x >= 0 && bounds.x + bounds.width <= 390 && bounds.height <= 844,
  );
  await page.locator("#modal button[type=submit]").scrollIntoViewIfNeeded();
  assert(await page.locator("#modal button[type=submit]").isVisible());
  await page.screenshot({
    path: "test-results/mobile-study-dialog.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.goto("http://127.0.0.1:8765/#study/" + ids.flash);
  await page.screenshot({
    path: "test-results/mobile-flashcards.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Open study timer" }).click();
  const timer = await page.locator("#timerPanel").boundingBox(),
    question = await page.locator(".study-card").boundingBox();
  assert(timer.y + timer.height <= question.y, "Timer covered the study card");
  assert.deepEqual(errors, []);
  console.log(
    "Populated themes, seven widths, four emulated zoom factors, long text, mobile dialog and timer space passed.",
  );
} finally {
  await browser.close();
}
