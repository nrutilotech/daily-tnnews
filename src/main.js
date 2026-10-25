// DAILY TNNEWS — Tamil Nadu news carousel bot.
//   node src/main.js build    collect → Gemini → photos → slides + caption in out/
//   node src/main.js post     publish out/ to Instagram (needs MEDIA_BASE_URL hosting the slides)
//   node src/main.js sample   render demo slides with dummy text (no API keys needed, never postable)
//   node src/main.js refresh-token   print a refreshed 60-day Instagram token
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { collectHeadlines } from "./collect.js";
import { curate } from "./curate.js";
import { findPhotos } from "./images.js";
import { renderSlides } from "./render.js";
import { publishCarousel, refreshToken } from "./instagram.js";
import { SAMPLE_EDITION } from "./sample.js";

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
    ...edition.stories.map((s, i) => `${NUM[i]} ${s.caption_line}`),
    "",
    `👉 Swipe through all ${edition.stories.length} slides for the details.`,
    `🔔 Follow ${config.handle} for Tamil Nadu news every morning & evening.`,
    "",
    `Sources: ${[...new Set(edition.stories.map((s) => s.source_name))].join(", ")}. Photos are illustrative.`,
    "",
    edition.hashtags.map((h) => "#" + h).join(" "),
  ];
  let caption = lines.join("\n");
  if (caption.length > 2200) caption = caption.slice(0, 2190) + "…";
  return caption;
}

function readHistory() {
  try {
    return JSON.parse(fs.readFileSync(config.stateFile, "utf8"));
  } catch {
    return [];
  }
}

function writeOutput(edition, slides, meta, extra = {}) {
  fs.rmSync(config.outDir, { recursive: true, force: true });
  fs.mkdirSync(config.outDir, { recursive: true });
  const files = slides.map((buf, i) => {
    const name = `${String(i + 1).padStart(2, "0")}.jpg`;
    fs.writeFileSync(path.join(config.outDir, name), buf);
    return name;
  });
  const caption = buildCaption(edition, meta);
  fs.writeFileSync(path.join(config.outDir, "caption.txt"), caption);
  fs.writeFileSync(path.join(config.outDir, "post.json"), JSON.stringify({ ...meta, ...extra, files, caption, edition }, null, 2));
  // quick local preview page
  fs.writeFileSync(
    path.join(config.outDir, "preview.html"),
    `<!doctype html><meta charset="utf-8"><title>${config.brand} preview</title>
<body style="margin:0;background:#111;color:#eee;font-family:sans-serif;padding:16px">
<div style="display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory">${files
      .map((f) => `<img src="${f}" style="height:80vh;scroll-snap-align:start;border-radius:8px">`)
      .join("")}</div><pre style="white-space:pre-wrap;max-width:700px">${caption.replace(/</g, "&lt;")}</pre></body>`,
  );
  return files;
}

async function build() {
  const meta = editionMeta();
  console.log(`Building ${meta.editionLabel}, ${meta.dateLabel}`);
  console.log("1/4 Collecting headlines…");
  const headlines = await collectHeadlines();
  console.log(`  ${headlines.length} candidate headlines`);
  console.log("2/4 Choosing the top stories with Gemini…");
  const edition = await curate(headlines, readHistory());
  edition.stories.forEach((s, i) => console.log(`  ${i + 1}. [${s.category}] ${s.headline}`));
  console.log("3/4 Finding photos…");
  const photos = await findPhotos(edition.stories);
  console.log("4/4 Drawing slides…");
  const slides = await renderSlides(edition, photos, meta);
  const files = writeOutput(edition, slides, meta);
  console.log(`Done: ${files.length} slides in out/ (open out/preview.html to check)`);
}

async function sample() {
  const meta = editionMeta();
  const slides = await renderSlides(SAMPLE_EDITION, SAMPLE_EDITION.stories.map(() => null), meta);
  writeOutput(SAMPLE_EDITION, slides, meta, { sample: true });
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
  // make sure the host is serving the images before Instagram tries to fetch them
  for (let i = 0; i < 12; i++) {
    const r = await fetch(urls[0], { method: "HEAD" }).catch(() => null);
    if (r?.ok) break;
    await new Promise((res) => setTimeout(res, 5000));
  }
  console.log("Publishing to Instagram…");
  const { mediaId, permalink } = await publishCarousel(urls, p.caption);
  console.log(`Posted! ${permalink ?? mediaId}`);

  const history = readHistory();
  history.push({ id: p.id, postedAt: new Date().toISOString(), mediaId, headlines: p.edition.stories.map((s) => s.headline) });
  fs.mkdirSync(path.dirname(config.stateFile), { recursive: true });
  fs.writeFileSync(config.stateFile, JSON.stringify(history.slice(-6), null, 2));
}

async function refresh() {
  const t = await refreshToken();
  // Hide the token from GitHub Actions logs; the workflow saves it as a secret.
  if (process.env.GITHUB_ACTIONS) console.log(`::add-mask::${t.access_token}`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `token=${t.access_token}\n`);
  else console.log(t.access_token);
  console.log(`Token valid for ${Math.round(t.expires_in / 86400)} more days`);
}

const cmd = process.argv[2];
const run = { build, post, sample, "refresh-token": refresh }[cmd];
if (!run) {
  console.log("Usage: node src/main.js build | post | sample | refresh-token");
  process.exit(1);
}
run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("FAILED:", e.message);
    process.exit(1);
  });
