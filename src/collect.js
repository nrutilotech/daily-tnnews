// Step 1: gather candidate headlines from news RSS feeds for the last N hours.
import Parser from "rss-parser";
import { config, FEEDS } from "./config.js";

const parser = new Parser({ timeout: 20000, headers: { "User-Agent": "Mozilla/5.0 DailyTNNewsBot/1.0" } });

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9஀-௿ ]/g, "").replace(/\s+/g, " ").trim();

// Spam and off-topic foreign-language results that sometimes leak into search feeds.
const FOREIGN_SCRIPT = /[぀-ヿ一-鿿가-힯]/;
const SPAM = /\b(mms|viral video|leaked video)\b/i;

export async function collectHeadlines() {
  const since = Date.now() - (config.windowHours + 2) * 3600 * 1000; // small overlap so nothing slips between runs
  const seen = new Set();
  const items = [];

  const results = await Promise.allSettled(FEEDS.map((f) => parser.parseURL(f.url).then((feed) => ({ f, feed }))));
  for (const r of results) {
    if (r.status !== "fulfilled") {
      console.warn("  feed failed:", r.reason?.message ?? r.reason);
      continue;
    }
    const { f, feed } = r.value;
    let kept = 0;
    for (const it of feed.items ?? []) {
      const t = Date.parse(it.isoDate || it.pubDate || "");
      if (kept >= 15) break; // per-feed cap keeps sports/weather/business from being crowded out
      if (!it.title || (t && t < since)) continue;
      if (FOREIGN_SCRIPT.test(it.title) || SPAM.test(it.title)) continue;
      // Google News titles end with " - Publisher"
      let title = it.title.trim();
      let source = it.creator || it.source?.title || f.name;
      const dash = title.lastIndexOf(" - ");
      if (f.url.includes("news.google.com") && dash > 20) {
        source = title.slice(dash + 3);
        title = title.slice(0, dash);
      }
      const key = norm(title).slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        title,
        source,
        link: it.link,
        published: t ? new Date(t).toISOString() : null,
        snippet: (it.contentSnippet || "").replace(/\s+/g, " ").slice(0, 240),
      });
      kept++;
    }
    console.log(`  ${f.name}: ${kept}`);
  }
  items.sort((a, b) => (b.published || "").localeCompare(a.published || ""));
  return items.slice(0, 180);
}
