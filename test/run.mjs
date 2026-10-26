// Offline checks for the bot: no API keys, no network. Gemini, Pixabay and Instagram are simulated.
//   npm test
import assert from "node:assert/strict";
import fs from "node:fs";

process.env.GEMINI_API_KEY = "test";
process.env.PIXABAY_API_KEY = "test";
process.env.IG_USER_ID = "1";
process.env.IG_ACCESS_TOKEN = "test";
process.env.POST_STORY = "true";

// make waits instant
const realSetTimeout = setTimeout;
globalThis.setTimeout = (fn, ms, ...a) => realSetTimeout(fn, Math.min(ms, 2), ...a);

const ok = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
const fail = (status, error) => new Response(JSON.stringify({ error }), { status, headers: { "content-type": "application/json" } });
const gem = (o) => ok({ candidates: [{ content: { parts: [{ text: typeof o === "string" ? o : JSON.stringify(o) }] } }] });
let handler = () => {
  throw new Error("unexpected fetch");
};
globalThis.fetch = async (url, opts = {}) => handler(String(url), opts);

const { SAMPLE_EDITION } = await import("../src/sample.js");
const { curate } = await import("../src/curate.js");
const { publishCarousel, publishStory } = await import("../src/instagram.js");
const { findPhotos } = await import("../src/images.js");
const { renderSlides, renderStory } = await import("../src/render.js");

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push(["ok", name]);
  } catch (e) {
    results.push(["FAIL", `${name}: ${e.message}`]);
  }
}
const quiet = async (fn) => {
  const [log, warn] = [console.log, console.warn];
  console.log = console.warn = () => {};
  try {
    return await fn();
  } finally {
    [console.log, console.warn] = [log, warn];
  }
};

const headlines = SAMPLE_EDITION.stories.map((s, i) => ({ title: s.headline, source: "Feed " + i, link: `https://example.com/story-${i + 1}` }));
const editionJson = (overrides = {}) => ({ ...SAMPLE_EDITION, stories: SAMPLE_EDITION.stories.map((s, i) => ({ ...s, source_number: i + 1 })), ...overrides });

await test("busy Gemini model falls back to the next one", async () => {
  const calls = [];
  handler = (url) => {
    const model = url.match(/models\/([^:]+)/)[1];
    calls.push(model);
    return model === "gemini-3.8-flash" ? fail(503, { message: "high demand" }) : gem(editionJson());
  };
  const ed = await quiet(() => curate(headlines, []));
  assert.equal(ed.stories.length, 10);
  assert.deepEqual(calls, ["gemini-3.8-flash", "gemini-3.8-flash", "gemini-3.6-flash"]);
});

await test("invalid JSON moves to the next model; unknown categories are repaired", async () => {
  let n = 0;
  handler = () => (n++ === 0 ? gem("{ not json") : gem(editionJson({ stories: editionJson().stories.map((s, i) => ({ ...s, category: i === 0 ? "sports" : i === 1 ? "Gossip" : s.category })) })));
  const ed = await quiet(() => curate(headlines, []));
  assert.equal(ed.stories[0].category, "Sports");
  assert.equal(ed.stories[1].category, "Government");
});

await test("story links come from the feed, not from the AI", async () => {
  handler = () => gem(editionJson());
  const ed = await quiet(() => curate(headlines, []));
  assert.equal(ed.stories[2].source_url, "https://example.com/story-3");
});

await test("stories already posted are set aside (even reworded)", async () => {
  const stories = editionJson().stories;
  stories[0] = { ...stories[0], headline: "Cyclone Signal No. 1 Raised Across Nine Tamil Nadu Ports" };
  handler = () => gem(editionJson({ stories }));
  const ed = await quiet(() => curate(headlines, [{ headlines: ["Cyclone Signal No. 1 Hoisted Across 9 Tamil Nadu Ports"] }]));
  assert.notEqual(ed.stories[0].headline, stories[0].headline);
  assert.equal(ed.stories.at(-1).headline, stories[0].headline);
});

await test("at most 2 politics stories; extras move down to keep a mix", async () => {
  const stories = editionJson().stories.map((s, i) => ({ ...s, category: i < 5 ? "Politics" : s.category }));
  handler = () => gem(editionJson({ stories }));
  const ed = await quiet(() => curate(headlines, []));
  const top = ed.stories.slice(0, 7).filter((s) => s.category === "Politics").length;
  assert.equal(top, 2);
});

await test("photo step: fashion photos never reach the check; rejected stories get no photo", async () => {
  let checkedImages = 0;
  handler = (url, opts) => {
    if (url.includes("generativelanguage")) {
      const body = JSON.parse(opts.body);
      const parts = body.contents[0].parts;
      if (parts.some((p) => p.inline_data)) {
        checkedImages = parts.filter((p) => p.inline_data).length;
        return gem({ picks: [{ story: 1, photo: 1, reason: "fits" }, { story: 2, photo: 0, reason: "nothing fits" }] });
      }
      return gem({ briefs: [1, 2].map((story) => ({ story, subject: "office", queries: ["office building"], people_ok: false, summary: "s", key_fact: "" })) });
    }
    if (url.startsWith("https://pixabay.com/api/")) {
      return ok({
        hits: [
          { id: 1, type: "photo", tags: "woman, model, fashion", webformatURL: "https://img/1", largeImageURL: "https://img/1L", user: "a", imageWidth: 1, imageHeight: 1 },
          { id: 2 + Math.random(), type: "photo", tags: "office, building", webformatURL: "https://img/2", largeImageURL: "https://img/2L", user: "b", imageWidth: 1, imageHeight: 1 },
        ],
      });
    }
    return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
  };
  const stories = SAMPLE_EDITION.stories.slice(0, 2).map((s) => ({ ...s, article_text: "x".repeat(400) }));
  const photos = await quiet(() => findPhotos(stories));
  assert.ok(photos[0], "story 1 should get a photo");
  assert.equal(photos[1], null);
  assert.ok(checkedImages > 0 && checkedImages <= 8);
});

await test("photo step: if the photo check fails, no unchecked photo is used", async () => {
  handler = (url, opts) => {
    if (url.includes("generativelanguage")) {
      const parts = JSON.parse(opts.body).contents[0].parts;
      return parts.some((p) => p.inline_data) ? fail(400, { message: "bad request" }) : gem({ briefs: [{ story: 1, subject: "office", queries: ["office"], people_ok: false, summary: "s", key_fact: "" }] });
    }
    if (url.startsWith("https://pixabay.com/api/")) return ok({ hits: [{ id: 9, type: "photo", tags: "office", webformatURL: "https://img/9", largeImageURL: "https://img/9L", user: "c" }] });
    return new Response(new Uint8Array([1]), { status: 200 });
  };
  const photos = await quiet(() => findPhotos(SAMPLE_EDITION.stories.slice(0, 1)));
  assert.deepEqual(photos, [null]);
});

await test("photo step: stories the check skipped are asked about again", async () => {
  const asked = [];
  handler = (url, opts) => {
    if (url.includes("generativelanguage")) {
      const parts = JSON.parse(opts.body).contents[0].parts;
      if (parts.some((p) => p.inline_data)) {
        const nums = parts.map((p) => p.text?.match(/^\n### Story (\d+)/)?.[1]).filter(Boolean).map(Number);
        asked.push(nums);
        // the first answer covers story 1 only (as a small backup model did); the second covers the rest
        return gem({ picks: (asked.length === 1 ? [1] : nums).map((story) => ({ story, photo: 1, reason: "fits" })) });
      }
      return gem({ briefs: [1, 2, 3, 4].map((story) => ({ story, subject: "office", queries: ["office building"], people_ok: false, summary: "s", key_fact: "" })) });
    }
    if (url.startsWith("https://pixabay.com/api/")) return ok({ hits: [{ id: Math.random(), type: "photo", tags: "office", webformatURL: "https://img/x", largeImageURL: "https://img/xL", user: "c", imageWidth: 1, imageHeight: 1 }] });
    return new Response(new Uint8Array([1]), { status: 200 });
  };
  const stories = SAMPLE_EDITION.stories.slice(0, 4).map((s) => ({ ...s, article_text: "x".repeat(400) }));
  const photos = await quiet(() => findPhotos(stories));
  assert.deepEqual(asked, [[1, 2, 3, 4], [2, 3, 4]]);
  assert.ok(photos.every(Boolean));
});

await test("the report's own photo is found (og:image), skipping logos", async () => {
  const { extractImage } = await import("../src/article.js");
  assert.equal(extractImage(`<meta content="/img/story.jpg" property="og:image">`, "https://news.example/a/1"), "https://news.example/img/story.jpg");
  assert.equal(extractImage(`<meta property="og:image" content="https://cdn.example/site-logo.png">`, "https://news.example/a/1"), null);
  assert.equal(extractImage(`<p>no image</p>`, "https://news.example/a/1"), null);
});

await test("photo step: news photos only when turned on; then credited, never for crime stories", async () => {
  const { createCanvas } = await import("@napi-rs/canvas");
  // a "photo" (varied colours) and a "logo card" (one flat colour)
  const png = (w, h, flat = false) => {
    const cv = createCanvas(w, h);
    const ctx = cv.getContext("2d");
    for (let x = 0; x < w; x += 40) for (let y = 0; y < h; y += 40) {
      ctx.fillStyle = flat ? "#d02000" : `rgb(${(x * 7) % 256},${(y * 5) % 256},${(x + y) % 256})`;
      ctx.fillRect(x, y, 40, 40);
    }
    return cv.toBuffer("image/png");
  };
  handler = (url, opts) => {
    if (url.includes("generativelanguage")) {
      const parts = JSON.parse(opts.body).contents[0].parts;
      if (parts.some((p) => p.inline_data)) return gem({ picks: [1, 2, 3, 4, 5, 6].map((story) => ({ story, photo: 0, reason: "nothing fits" })) });
      return gem({ briefs: [1, 2, 3, 4, 5, 6].map((story) => ({ story, subject: "office", queries: ["office"], people_ok: false, summary: "s", key_fact: "" })) });
    }
    if (url.startsWith("https://pixabay.com/api/")) return ok({ hits: [{ id: Math.random(), type: "photo", tags: "office", webformatURL: "https://img/x", largeImageURL: "https://img/xL", user: "c", imageWidth: 1, imageHeight: 1 }] });
    if (/news\.example\/(photo|crime|shared)/.test(url)) return new Response(png(1200, 675), { status: 200 });
    if (url === "https://news.example/tiny.jpg") return new Response(png(200, 200), { status: 200 });
    if (url === "https://news.example/logo-card.jpg") return new Response(png(1200, 630, true), { status: 200 });
    return new Response(new Uint8Array([1]), { status: 200 });
  };
  const base = SAMPLE_EDITION.stories[0];
  const stories = [
    { ...base, category: "Weather", source_name: "The Hindu – Tamil Nadu", source_image: "https://news.example/photo.jpg" },
    { ...base, category: "Law & Order", source_name: "DT Next", source_image: "https://news.example/crime.jpg" },
    { ...base, category: "Health", source_name: "DT Next", source_image: "https://news.example/tiny.jpg" },
    { ...base, category: "Sports", source_name: "TOI", source_image: "https://news.example/logo-card.jpg" },
    { ...base, category: "Business", source_name: "TOI", source_image: "https://news.example/shared.jpg" },
    { ...base, category: "Transport", source_name: "TOI", source_image: "https://news.example/shared.jpg" },
  ];
  const { config } = await import("../src/config.js");
  assert.deepEqual(await quiet(() => findPhotos(stories)), stories.map(() => null), "news photos are off unless SOURCE_PHOTOS=true");
  config.sourcePhotos = true;
  try {
    const photos = await quiet(() => findPhotos(stories));
    assert.equal(photos[0]?.credit, "Photo: The Hindu");
    assert.deepEqual(photos.slice(1), [null, null, null, null, null], "crime, tiny, logo card and a shared default image are all skipped");
  } finally {
    config.sourcePhotos = false;
  }
});

// (after the other Gemini tests: a used-up model stays skipped for the rest of the process)
await test("a model out of its daily quota is skipped at once, and for the rest of the run", async () => {
  const calls = [];
  const daily = { message: "You exceeded your current quota", details: [{ violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }] };
  handler = (url) => {
    const model = url.match(/models\/([^:]+)/)[1];
    calls.push(model);
    return model === "gemini-3.8-flash" ? fail(429, daily) : gem(editionJson());
  };
  await quiet(() => curate(headlines, []));
  await quiet(() => curate(headlines, []));
  assert.deepEqual(calls, ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.6-flash"]);
});

const igHandler = (scenario, log) => (url, opts) => {
  const body = opts.body ? Object.fromEntries(new URLSearchParams(opts.body)) : {};
  if (url.includes("media_publish")) {
    log.push("publish");
    if (scenario === "notready" && log.filter((l) => l === "publish").length === 1) return fail(400, { message: "Media ID is not available", code: 9007 });
    if (scenario === "notfound" && log.filter((l) => l === "publish").length === 1) return fail(400, { message: "The requested resource does not exist", code: 24, error_user_msg: "The media with 1 cannot be found." });
    if (scenario === "timeout") {
      const e = new Error("t");
      e.name = "TimeoutError";
      throw e;
    }
    return ok({ id: "M1" });
  }
  if ((opts.method ?? "GET") === "GET") return ok(url.includes("permalink") ? { permalink: "https://instagram.com/p/x" } : { status_code: "FINISHED" });
  if (scenario === "flaky" && body.is_carousel_item && !log.includes("flaked")) {
    log.push("flaked");
    return fail(500, { message: "Please retry", is_transient: true });
  }
  return ok({ id: "C" + Math.random() });
};

await test("Instagram: temporary errors are retried", async () => {
  const log = [];
  handler = igHandler("flaky", log);
  const r = await quiet(() => publishCarousel(["a", "b", "c"], "cap"));
  assert.equal(r.permalink, "https://instagram.com/p/x");
});

await test('Instagram: "media not ready" waits and publishes once', async () => {
  const log = [];
  handler = igHandler("notready", log);
  await quiet(() => publishCarousel(["a", "b"], "cap"));
  assert.equal(log.filter((l) => l === "publish").length, 2);
});

await test('Instagram: Story "cannot be found" right after upload waits and publishes once', async () => {
  const log = [];
  handler = igHandler("notfound", log);
  assert.equal(await quiet(() => publishStory("https://img/story.jpg")), "M1");
  assert.equal(log.filter((l) => l === "publish").length, 2);
});

await test("Instagram: a publish that timed out is never repeated (no double posts)", async () => {
  const log = [];
  handler = igHandler("timeout", log);
  await assert.rejects(quiet(() => publishCarousel(["a", "b"], "cap")));
  assert.equal(log.filter((l) => l === "publish").length, 1);
});

await test("Instagram: Story publishes", async () => {
  handler = igHandler("ok", []);
  assert.equal(await quiet(() => publishStory("https://x/story.jpg")), "M1");
});

await test("slides and Story render (English and Tamil)", async () => {
  const meta = { editionLabel: "Evening Edition", dateLabel: "25 October 2026" };
  const photos = SAMPLE_EDITION.stories.map(() => null);
  const slides = await renderSlides(SAMPLE_EDITION, photos, meta);
  assert.equal(slides.length, 10);
  const tamil = { ...SAMPLE_EDITION, stories: SAMPLE_EDITION.stories.map((s) => ({ ...s, headline: "கடலோர மாவட்டங்களில் கனமழை எச்சரிக்கை", summary: "மாதிரி உரை." })) };
  const story = await renderStory(tamil, photos, meta);
  assert.ok(story.length > 10000);
  assert.equal(story[0], 0xff); // JPEG
});

await test("short links: readable code from v.gd; falls back to the next service, then to none", async () => {
  const { shortenAll } = await import("../src/shorten.js");
  let calls = [];
  handler = (url) => {
    calls.push(new URL(url).hostname);
    const c = new URL(url).searchParams.get("shorturl");
    if (url.includes("v.gd")) return new Response(`https://v.gd/${c}`, { status: 200 });
    return new Response("Error", { status: 500 });
  };
  const [one] = await shortenAll(["https://example.com/a"]);
  assert.match(one, /^https:\/\/v\.gd\/tnn[a-hjkmnp-z2-9]{5}$/);
  calls = [];
  handler = (url) => {
    calls.push(new URL(url).hostname);
    if (url.includes("tinyurl")) return new Response("https://tinyurl.com/abc123", { status: 200 });
    throw new TypeError("fetch failed");
  };
  const [two] = await shortenAll(["https://example.com/b"]);
  assert.equal(two, "https://tinyurl.com/abc123");
  handler = () => {
    throw new TypeError("fetch failed");
  };
  const [three] = await quiet(() => shortenAll(["https://example.com/c"]));
  assert.equal(three, null);
});

const threadsEdition = {
  id: "2026102514",
  editionLabel: "Evening Edition",
  dateLabel: "25 October 2026",
  edition: {
    edition_summary: "A long summary. ".repeat(40),
    stories: SAMPLE_EDITION.stories.map((s, i) => ({ ...s, summary: "Detail ".repeat(80), source_url: `https://www.example.com/news/tamil-nadu/a-very-long-article-address-${i}-${"x".repeat(60)}` })),
  },
};

await test("Threads: the post fits the 500-character limit and links to the news page", async () => {
  process.env.THREADS_ACCESS_TOKEN = "t";
  const { threadText } = await import("../src/threads.js");
  const text = threadText(threadsEdition, { pageUrl: "https://example.github.io/news/" });
  assert.ok(Buffer.byteLength(text) <= 500, `${Buffer.byteLength(text)} bytes`);
  assert.ok(text.includes("https://example.github.io/news/"));
});

await test("Threads: one post only (slides + text), no replies or comments", async () => {
  const { config } = await import("../src/config.js");
  config.threadsToken = "t";
  config.threadsUserId = "99";
  const log = [];
  let n = 0;
  handler = (url, opts) => {
    const body = opts.body ? Object.fromEntries(new URLSearchParams(opts.body)) : {};
    if ((opts.method ?? "GET") === "GET") return ok(url.includes("permalink") ? { permalink: "https://www.threads.net/@dailytnnews/post/x" } : { status: "FINISHED" });
    if (url.endsWith("/threads_publish")) {
      log.push("publish");
      return ok({ id: "P" + body.creation_id });
    }
    log.push(body.media_type + (body.reply_to_id ? "-reply" : ""));
    return ok({ id: "C" + ++n });
  };
  const { postEditionToThreads } = await import("../src/threads.js");
  const r = await quiet(() => postEditionToThreads(threadsEdition, ["https://img/1", "https://img/2"]));
  assert.deepEqual(log, ["IMAGE", "IMAGE", "CAROUSEL", "publish"]);
  assert.equal(r.permalink, "https://www.threads.net/@dailytnnews/post/x");
});

await test('Threads: "resource does not exist" at publish waits and publishes once', async () => {
  const log = [];
  handler = (url, opts) => {
    if ((opts.method ?? "GET") === "GET") return ok({ status: "FINISHED" });
    if (url.endsWith("/threads_publish")) {
      log.push("publish");
      return log.length === 1 ? fail(400, { message: "The requested resource does not exist", code: 24 }) : ok({ id: "P1" });
    }
    return ok({ id: "C1" });
  };
  const { postEditionToThreads } = await import("../src/threads.js");
  await quiet(() => postEditionToThreads(threadsEdition, ["https://img/1", "https://img/2"]));
  assert.deepEqual(log, ["publish", "publish"]);
});

await test("Threads: if the images fail, the text is posted on its own", async () => {
  const log = [];
  handler = (url, opts) => {
    const body = opts.body ? Object.fromEntries(new URLSearchParams(opts.body)) : {};
    if ((opts.method ?? "GET") === "GET") return ok({ status: "FINISHED" });
    if (url.endsWith("/threads_publish")) return ok({ id: "P1" });
    if (body.media_type === "IMAGE") return fail(400, { message: "bad image" });
    log.push(body.media_type);
    return ok({ id: "C1" });
  };
  const { postEditionToThreads } = await import("../src/threads.js");
  await quiet(() => postEditionToThreads(threadsEdition, ["https://img/1"]));
  assert.deepEqual(log, ["TEXT"]);
});

await test("workflow files are in place", async () => {
  for (const f of ["post-news.yml", "news-page.yml", "refresh-token.yml", "finish-edition.yml"]) assert.ok(fs.existsSync(new URL(`../.github/workflows/${f}`, import.meta.url)), f);
  const post = fs.readFileSync(new URL("../.github/workflows/post-news.yml", import.meta.url), "utf8");
  assert.ok(!/\$\{\{\s*github\.token\s*\}\}@/.test(post), "token must not be inlined in a URL");
  // the bot must never comment or reply on posts
  for (const f of fs.readdirSync(new URL("../src/", import.meta.url))) {
    const code = fs.readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
    assert.ok(!/reply_to_id|\/comments|\/replies|comment_id/.test(code), `no comment/reply code in ${f}`);
  }
});

for (const [status, name] of results) console.log(`${status === "ok" ? "✓" : "✗"} ${name}`);
const failed = results.filter((r) => r[0] !== "ok").length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
