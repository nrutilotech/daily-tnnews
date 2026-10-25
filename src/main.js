// DAILY TNNEWS — Tamil Nadu news carousel bot.
//   node src/main.js build    collect → Gemini → photos → slides + caption in out/
//   node src/main.js post     publish out/ to Instagram (needs MEDIA_BASE_URL hosting the slides)
//   node src/main.js sample   render demo slides with dummy text (no API keys needed, never postable)
//   node src/main.js refresh-token   print a refreshed 60-day Instagram token
//   node src/main.js site     build the "link in bio" news page into site/
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { collectHeadlines } from "./collect.js";
import { curate } from "./curate.js";
import { findPhotos } from "./images.js";
import { readArticles } from "./article.js";
import { shortenAll } from "./shorten.js";
import { renderSlides, renderStory } from "./render.js";
import { publishCarousel, publishStory, refreshToken } from "./instagram.js";
import { SAMPLE_EDITION } from "./sample.js";
import { buildSite, saveEdition } from "./site.js";

const NUM = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

function editionMeta(date = new Date()) {
  const hour = Number(date.toLocaleString("en-GB", { timeZone: config.timezone, hour: "2-digit", hour12: false }));
  return {
    editionLabel: hour < 15 ? "Morning Edition" : "Evening Edition",
    dateLabel: date.toLocaleDateString("en-IN", { timeZone: config.timezone, day: "numeric", month: "long", year: "numeric" }),
    id: date.toISOString().slice(0, 13).replace(/[-T]/g, ""),
  };
}

function buildCaption(edition, meta) {
  const lines = [
    `📰 ${config.brand} | ${meta.dateLabel} · ${meta.editionLabel}`,
    "",
    `🕛 Tamil Nadu in the last ${config.windowHours} hours:`,
    edition.edition_summary,
    "",
    ...edition.stories.map((s, i) => `${NUM[i]} ${s.caption_line}${s.short_url ? ` → ${s.short_url.replace(/^https?:\/\//, "")}` : ""}`),
    "",
    `👉 Swipe through all ${edition.stories.length} slides for the details.`,
    `🔗 Full stories with links to the original reports: link in bio.`,
    `🔔 Follow ${config.handle} for Tamil Nadu news every morning & evening.`,
    "",
    `Sources: ${[...new Set(edition.stories.map((s) => s.source_name))].join(", ")}. Photos are illustrative.`,
    "",
    edition.hashtags.map((h) => "#" + h).join(" "),
  ];
  // Instagram's limit is 2,200 characters: drop hashtags first, then cut the end
  let caption = lines.join("\n");
  const tags = [...edition.hashtags];
  while (caption.length > 2200 && tags.length) {
    tags.pop();
    lines[lines.length - 1] = tags.map((h) => "#" + h).join(" ");
    caption = lines.join("\n");
  }
  if (caption.length > 2200) caption = caption.slice(0, 2199) + "…";
  return caption;
}

function readHistory() {
  try {
    return JSON.parse(fs.readFileSync(config.stateFile, "utf8"));
  } catch {
    return [];
  }
}

function writeOutput(edition, slides, meta, extra = {}, story = null) {
  fs.rmSync(config.outDir, { recursive: true, force: true });
  fs.mkdirSync(config.outDir, { recursive: true });
  const files = slides.map((buf, i) => {
    const name = `${String(i + 1).padStart(2, "0")}.jpg`;
    fs.writeFileSync(path.join(config.outDir, name), buf);
    return name;
  });
  if (story) fs.writeFileSync(path.join(config.outDir, "story.jpg"), story);
  const caption = buildCaption(edition, meta);
  fs.writeFileSync(path.join(config.outDir, "caption.txt"), caption);
  fs.writeFileSync(path.join(config.outDir, "post.json"), JSON.stringify({ ...meta, ...extra, files, story: story ? "story.jpg" : null, caption, edition }, null, 2));
  // quick local preview page
  fs.writeFileSync(
    path.join(config.outDir, "preview.html"),
    `<!doctype html><meta charset="utf-8"><title>${config.brand} preview</title>
<body style="margin:0;background:#111;color:#eee;font-family:sans-serif;padding:16px">
<div style="display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory">${files
      .map((f) => `<img src="${f}" style="height:80vh;scroll-snap-align:start;border-radius:8px">`)
      .join("")}${story ? `<img src="story.jpg" style="height:80vh;border-radius:8px;margin-left:24px">` : ""}</div><pre style="white-space:pre-wrap;max-width:700px">${caption.replace(/</g, "&lt;")}</pre></body>`,
  );
  return files;
}

async function build() {
  const meta = editionMeta();
  console.log(`Building ${meta.editionLabel}, ${meta.dateLabel}`);
  console.log("1/5 Collecting headlines…");
  const headlines = await collectHeadlines();
  console.log(`  ${headlines.length} candidate headlines`);
  console.log("2/5 Choosing the top stories with Gemini…");
  const edition = await curate(headlines, readHistory());
  edition.stories.forEach((s, i) => console.log(`  ${i + 1}. [${s.category}] ${s.headline}`));
  console.log("3/5 Reading the full articles…");
  const articles = await readArticles(edition.stories.map((s) => s.source_url));
  articles.forEach((a, i) => {
    const s = edition.stories[i];
    s.article_text = a.text;
    // link straight to the publisher's article instead of the Google News redirect
    if (a.url && /^https?:\/\//.test(a.url) && !/news\.google\.com/.test(a.url)) s.source_url = a.url;
  });
  console.log(`  read ${articles.filter((a) => a.text.length >= 300).length} of ${articles.length} full articles`);
  // short, typeable links for the slides (the news page keeps the full links)
  const shortLinks = await shortenAll(edition.stories.map((s) => s.source_url));
  shortLinks.forEach((u, i) => u && (edition.stories[i].short_url = u));
  console.log(`  shortened ${shortLinks.filter(Boolean).length} of ${shortLinks.length} links`);
  console.log("4/5 Choosing photos that fit each article…");
  const photos = await findPhotos(edition.stories);
  // the article text is only used here; it is the publisher's text, so it isn't kept or published
  edition.stories.forEach((s) => delete s.article_text);
  console.log("5/5 Drawing slides…");
  const slides = await renderSlides(edition, photos, meta);
  const story = await renderStory(edition, photos, meta);
  const files = writeOutput(edition, slides, meta, {}, story);
  console.log(`Done: ${files.length} slides in out/ (open out/preview.html to check)`);
}

async function sample() {
  const meta = editionMeta();
  const photos = SAMPLE_EDITION.stories.map(() => null);
  const slides = await renderSlides(SAMPLE_EDITION, photos, meta);
  writeOutput(SAMPLE_EDITION, slides, meta, { sample: true }, await renderStory(SAMPLE_EDITION, photos, meta));
  console.log("Sample slides written to out/ — open out/preview.html");
}

async function post() {
  const postFile = path.join(config.outDir, "post.json");
  if (!fs.existsSync(postFile)) throw new Error("Nothing to post — run build first");
  const p = JSON.parse(fs.readFileSync(postFile, "utf8"));
  if (p.sample) throw new Error("out/ holds sample slides with dummy text — refusing to post them");
  if (!config.mediaBaseUrl) throw new Error("MEDIA_BASE_URL is not set");
  const urls = p.files.map((f) => `${config.mediaBaseUrl}/${p.id}/${f}`);

  if (config.dryRun) {
    console.log("DRY_RUN is on — not posting. Would post:\n" + urls.join("\n") + "\n\n" + p.caption);
    return;
  }
  const history = readHistory();
  if (history.some((h) => h.id === p.id)) {
    console.log(`Edition ${p.id} was already posted — skipping so it isn't posted twice.`);
    return;
  }
  // A late scheduled run right after a manual post would only repeat the news: skip it.
  const last = history[history.length - 1];
  const hoursSince = last ? (Date.now() - Date.parse(last.postedAt)) / 3600000 : Infinity;
  if (process.env.GITHUB_EVENT_NAME === "schedule" && hoursSince < 6) {
    console.log(`An edition was posted ${hoursSince.toFixed(1)} hours ago — skipping this scheduled run.`);
    return;
  }
  // make sure every slide is being served before Instagram tries to fetch them
  for (const url of urls) {
    let ok = false;
    for (let i = 0; i < 12 && !ok; i++) {
      const r = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(15000) }).catch(() => null);
      ok = !!r?.ok;
      if (!ok) await new Promise((res) => setTimeout(res, 5000));
    }
    if (!ok) throw new Error(`Slide not reachable at ${url} — check the media branch`);
  }
  console.log("Publishing to Instagram…");
  const { mediaId, permalink } = await publishCarousel(urls, p.caption);
  console.log(`Posted! ${permalink ?? mediaId}`);

  const entry = { id: p.id, postedAt: new Date().toISOString(), mediaId, headlines: p.edition.stories.map((s) => s.headline) };
  history.push(entry);
  const saveHistory = () => {
    fs.mkdirSync(path.dirname(config.stateFile), { recursive: true });
    fs.writeFileSync(config.stateFile, JSON.stringify(history.slice(-6), null, 2));
  };
  saveHistory(); // saved before the Story, so a Story problem can't cause the edition to be posted again
  // the "link in bio" news page is rebuilt from this list
  saveEdition({
    id: p.id,
    editionLabel: p.editionLabel,
    dateLabel: p.dateLabel,
    postedAt: entry.postedAt,
    permalink: permalink ?? null,
    summary: p.edition.edition_summary,
    files: p.files,
    stories: p.edition.stories.map(({ category, headline, summary, key_fact, source_name, source_url }) => ({ category, headline, summary, key_fact, source_name, source_url })),
  });

  // The Story is a bonus: if it fails, the carousel is already up and the run still succeeds.
  if (config.postStory && p.story) {
    try {
      const storyUrl = `${config.mediaBaseUrl}/${p.id}/${p.story}`;
      const r = await fetch(storyUrl, { method: "HEAD", signal: AbortSignal.timeout(15000) }).catch(() => null);
      if (!r?.ok) throw new Error(`story image not reachable at ${storyUrl}`);
      console.log("Publishing the Story…");
      entry.storyId = await publishStory(storyUrl);
      saveHistory();
      console.log("Story posted.");
    } catch (e) {
      console.log(`::warning::Carousel posted, but the Story failed: ${e.message}`);
    }
  }
}

async function refresh() {
  const t = await refreshToken();
  // In GitHub Actions the new token goes to a private temp file (never the log or a step output),
  // and the workflow's next step saves it as the IG_ACCESS_TOKEN secret.
  if (process.env.RUNNER_TEMP) {
    console.log(`::add-mask::${t.access_token}`);
    fs.writeFileSync(path.join(process.env.RUNNER_TEMP, "ig_token"), t.access_token, { mode: 0o600 });
  } else console.log(t.access_token);
  console.log(`Token renewed — valid for ${Math.round(t.expires_in / 86400)} more days`);
}

const cmd = process.argv[2];
async function site() {
  const { editions, dir } = await buildSite();
  console.log(`News page built from ${editions} edition(s) in ${path.relative(process.cwd(), dir) || dir}/`);
}

const run = { build, post, sample, site, "refresh-token": refresh }[cmd];
if (!run) {
  console.log("Usage: node src/main.js build | post | sample | site | refresh-token");
  process.exit(1);
}
run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("FAILED:", e.message);
    process.exit(1);
  });
