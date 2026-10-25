// The "link in bio" news page: every story from the recent editions with its summary and a link to
// the full article at the source. Built from state/editions.json and published with GitHub Pages.
import fs from "node:fs";
import path from "node:path";
import { config, ROOT } from "./config.js";
import { CATEGORY_COLORS } from "./render.js";

export const EDITIONS_FILE = path.join(ROOT, "state", "editions.json");
const SITE_DIR = path.join(ROOT, "site");
const KEEP = 14; // one week of morning + evening editions

// only ordinary web links are ever put on the page
const safeUrl = (u) => (/^https?:\/\//i.test(String(u ?? "")) ? u : "#");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function readEditions() {
  try {
    return JSON.parse(fs.readFileSync(EDITIONS_FILE, "utf8"));
  } catch {
    return [];
  }
}

// Called after a successful post: newest first, one week kept.
export function saveEdition(entry) {
  const list = readEditions().filter((e) => e.id !== entry.id);
  list.unshift(entry);
  fs.mkdirSync(path.dirname(EDITIONS_FILE), { recursive: true });
  fs.writeFileSync(EDITIONS_FILE, JSON.stringify(list.slice(0, KEEP), null, 2));
}

function storyCard(s, i, editionId) {
  const color = CATEGORY_COLORS[s.category] ?? "#E11D2E";
  return `<article class="story" id="${esc(editionId)}-${i + 1}">
  <div class="meta"><span class="num">${String(i + 1).padStart(2, "0")}</span><span class="cat" style="background:${color}">${esc(s.category)}</span></div>
  <h3>${esc(s.headline)}</h3>
  ${s.key_fact ? `<p class="fact" style="border-color:${color}">${esc(s.key_fact)}</p>` : ""}
  <p>${esc(s.summary)}</p>
  <a class="read" href="${esc(safeUrl(s.source_url))}" target="_blank" rel="noopener">Read the full story${s.source_name ? ` on ${esc(s.source_name)}` : ""} <span aria-hidden="true">↗</span></a>
</article>`;
}

export async function buildSite(mediaBaseUrl = config.mediaBaseUrl) {
  const editions = readEditions();
  const [latest, ...older] = editions;
  const handle = config.handle.replace(/^@/, "");

  // the media branch only holds the latest *posted* slides; skip the strip if they're not there
  let slidesHosted = false;
  if (mediaBaseUrl && latest?.files?.length) {
    const r = await fetch(`${mediaBaseUrl}/${latest.id}/${latest.files[0]}`, { method: "HEAD", signal: AbortSignal.timeout(15000) }).catch(() => null);
    slidesHosted = !!r?.ok;
  }
  const [owner, repo] = (process.env.GITHUB_REPOSITORY || "").split("/");
  const pageUrl = owner && repo ? `https://${owner}.github.io/${repo}/` : "";

  const latestHtml = latest
    ? `<section class="edition latest" id="${esc(latest.id)}">
  <p class="label">${esc(latest.editionLabel)} · ${esc(latest.dateLabel)}</p>
  <h2>Tamil Nadu in the last ${config.windowHours} hours</h2>
  <p class="summary">${esc(latest.summary)}</p>
  ${latest.permalink ? `<a class="ig" href="${esc(safeUrl(latest.permalink))}" target="_blank" rel="noopener">View this edition on Instagram</a>` : ""}
  ${
    slidesHosted
      ? `<div class="slides" aria-label="Slides from this edition">${latest.files
          .map((f, i) => `<img src="${esc(`${mediaBaseUrl}/${latest.id}/${f}`)}" alt="Slide ${i + 1}" loading="lazy" width="1080" height="1350">`)
          .join("")}</div>`
      : ""
  }
  ${latest.stories.map((s, i) => storyCard(s, i, latest.id)).join("\n")}
</section>`
    : `<section class="edition latest"><h2>The first edition will appear here after the next post.</h2></section>`;

  const olderHtml = older.length
    ? `<section class="older"><h2>Earlier editions</h2>${older
        .map(
          (e) => `<details id="${esc(e.id)}"><summary><span>${esc(e.editionLabel)}</span> · ${esc(e.dateLabel)}</summary>
  <ol>${e.stories.map((s) => `<li><a href="${esc(safeUrl(s.source_url))}" target="_blank" rel="noopener">${esc(s.headline)}</a> <small>${esc(s.source_name)}</small></li>`).join("")}</ol>
</details>`,
        )
        .join("\n")}</section>`
    : "";

  const updated = latest ? `${latest.editionLabel}, ${latest.dateLabel}` : "";
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(config.brand)} · Tamil Nadu's top 10 news</title>
<meta name="description" content="Tamil Nadu's top 10 news every morning and evening, with links to the full stories.">
<link rel="icon" href="icon.png">
<meta property="og:title" content="${esc(config.brand)}">
<meta property="og:description" content="Tamil Nadu's top 10 news, twice a day. ${esc(updated)}">
<meta property="og:image" content="${pageUrl}icon.png">${pageUrl ? `
<link rel="canonical" href="${pageUrl}">` : ""}
<style>
  :root { --navy:#0A1A33; --red:#E11D2E; --yellow:#FFC93C; --paper:#F7F5F0; --ink:#0F172A; --gray:#475467; --card:#FFFFFF; --line:#E4DFD3; }
  @media (prefers-color-scheme: dark) { :root { --paper:#0B1220; --ink:#F1F5F9; --gray:#A8B3C4; --card:#131C2E; --line:#22304A; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--paper); color:var(--ink); font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans","Noto Sans Tamil",sans-serif; }
  header { background:var(--navy); color:#fff; padding:28px 16px 24px; text-align:center; }
  header img { width:84px; height:84px; border-radius:50%; display:block; margin:0 auto 12px; }
  .brand { display:inline-flex; gap:8px; align-items:center; font-weight:800; font-size:26px; letter-spacing:.5px; }
  .brand b { background:var(--red); padding:2px 10px; border-radius:8px; }
  header p { margin:8px 0 0; color:#CBD5E1; font-size:15px; }
  header a { color:var(--yellow); font-weight:600; text-decoration:none; }
  main { max-width:720px; margin:0 auto; padding:16px; }
  .label { color:var(--red); font-weight:800; letter-spacing:1px; text-transform:uppercase; font-size:13px; margin:12px 0 4px; }
  h2 { font-size:24px; line-height:1.25; margin:0 0 8px; }
  .summary { color:var(--gray); margin:0 0 14px; }
  .ig { display:inline-block; margin-bottom:16px; font-weight:700; color:var(--red); text-decoration:none; }
  .slides { display:flex; gap:10px; overflow-x:auto; scroll-snap-type:x mandatory; margin:0 -16px 20px; padding:0 16px 6px; }
  .slides img { height:300px; width:auto; border-radius:10px; scroll-snap-align:start; flex:none; background:#1B2A44; }
  .story { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:16px 18px; margin:0 0 14px; }
  .meta { display:flex; gap:8px; align-items:center; margin-bottom:8px; }
  .num { background:var(--red); color:#fff; font-weight:800; border-radius:8px; padding:2px 8px; font-size:14px; }
  .cat { color:#fff; font-weight:700; border-radius:999px; padding:2px 10px; font-size:12px; text-transform:uppercase; letter-spacing:.5px; }
  .story h3 { font-size:19px; line-height:1.3; margin:0 0 6px; }
  .story p { margin:0 0 10px; color:var(--gray); }
  .story .fact { border-left:4px solid; padding-left:10px; font-weight:600; color:var(--ink); }
  .read { display:inline-block; background:var(--navy); color:#fff; text-decoration:none; font-weight:700; padding:9px 14px; border-radius:10px; font-size:15px; }
  @media (prefers-color-scheme: dark) { .read { background:var(--red); } }
  .older { margin-top:28px; }
  details { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:10px 14px; margin-bottom:10px; }
  summary { cursor:pointer; font-weight:700; }
  summary span { color:var(--red); }
  ol { padding-left:22px; margin:10px 0 4px; }
  li { margin-bottom:8px; } li a { color:var(--ink); font-weight:600; } li small { color:var(--gray); }
  footer { max-width:720px; margin:0 auto; padding:24px 16px 40px; color:var(--gray); font-size:13px; text-align:center; }
</style>
</head>
<body>
<header>
  <img src="icon.png" alt="">
  <div class="brand"><b>DAILY</b> TNNEWS</div>
  <p>Tamil Nadu's top 10 news, every morning &amp; evening · <a href="https://www.instagram.com/${esc(handle)}/">@${esc(handle)}</a></p>
</header>
<main>
${latestHtml}
${olderHtml}
</main>
<footer>Summaries are written with AI from public news reports. Tap “Read the full story” for the original report. Photos on the slides are illustrative.${updated ? `<br>Last updated: ${esc(updated)}.` : ""}</footer>
</body>
</html>
`;
  fs.rmSync(SITE_DIR, { recursive: true, force: true });
  fs.mkdirSync(SITE_DIR, { recursive: true });
  fs.writeFileSync(path.join(SITE_DIR, "index.html"), html);
  fs.copyFileSync(path.join(ROOT, "brand", "profile-preview-330.png"), path.join(SITE_DIR, "icon.png"));
  fs.writeFileSync(path.join(SITE_DIR, ".nojekyll"), "");
  return { editions: editions.length, dir: SITE_DIR };
}
