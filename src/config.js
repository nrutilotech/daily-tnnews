// All settings live here. Anything secret comes from environment variables
// (GitHub Actions secrets in production, a local .env file when testing).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Minimal .env loader so local runs work without an extra package.
const envFile = path.join(ROOT, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const env = (k, d = "") => (process.env[k] ?? d).trim();

export const config = {
  brand: env("BRAND_NAME", "DAILY TNNEWS"),
  handle: env("INSTAGRAM_HANDLE", "@daily.tnnews"),
  // "en" = English slides, "ta" = Tamil slides (caption headlines follow the same language)
  language: env("NEWS_LANGUAGE", "en"),
  timezone: "Asia/Kolkata",
  windowHours: Number(env("WINDOW_HOURS", "12")),
  storyCount: 10, // Instagram carousels allow at most 10 slides: cover (story 1) + 9 more

  // Gemini API (free tier). Google Search grounding isn't free for new users, so by default the bot
  // works from the feed headlines only. Set GEMINI_RESEARCH_MODEL (e.g. a paid model) to add search.
  geminiKey: env("GEMINI_API_KEY"),
  researchModel: env("GEMINI_RESEARCH_MODEL", ""),
  writerModel: env("GEMINI_WRITER_MODEL", "gemini-3.8-flash"),
  // tried in order when the main model is busy or unavailable (all on the free tier)
  backupModels: env("GEMINI_BACKUP_MODELS", "gemini-3.6-flash,gemini-3.5-flash-lite").split(",").map((s) => s.trim()),
  pixabayKey: env("PIXABAY_API_KEY"),
  pexelsKey: env("PEXELS_API_KEY"), // optional alternative; Pixabay is used when both are set

  igUserId: env("IG_USER_ID"),
  igToken: env("IG_ACCESS_TOKEN"),
  // graph.instagram.com for "Instagram API with Instagram Login" (no Facebook Page needed);
  // graph.facebook.com if you connected through a Facebook Page instead.
  igHost: env("IG_GRAPH_HOST", "graph.instagram.com"),
  igApiVersion: env("IG_API_VERSION", "v23.0"),
  // Public base URL where the rendered slides can be downloaded by Instagram,
  // e.g. https://raw.githubusercontent.com/<you>/<repo>/media
  mediaBaseUrl: env("MEDIA_BASE_URL").replace(/\/+$/, ""),

  dryRun: /^(1|true|yes)$/i.test(env("DRY_RUN", "false")),

  outDir: path.join(ROOT, "out"),
  stateFile: path.join(ROOT, "state", "history.json"),
  fontsDir: path.join(ROOT, "fonts"),
};

// News feeds. Google News searches are limited to the last 12 hours with "when:12h".
const gnews = (q, lang = "en") =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q + " when:12h")}&hl=${lang}-IN&gl=IN&ceid=IN:${lang}`;

export const FEEDS = [
  { name: "The Hindu – Tamil Nadu", url: "https://www.thehindu.com/news/national/tamil-nadu/feeder/default.rss" },
  { name: "The Hindu – Chennai", url: "https://www.thehindu.com/news/cities/chennai/feeder/default.rss" },
  { name: "Times of India – Chennai", url: "https://timesofindia.indiatimes.com/rssfeeds/2950623.cms" },
  { name: "Google News – Tamil Nadu", url: gnews("Tamil Nadu") },
  { name: "Google News – TN government", url: gnews("Tamil Nadu government announces") },
  { name: "Google News – Tamil Nadu govt orders", url: gnews("Tamil Nadu G.O. OR scheme OR Chief Minister") },
  { name: "Google News – Tamil (தமிழ்நாடு அரசு)", url: gnews("தமிழ்நாடு அரசு", "ta") },
  { name: "Google News – Chennai", url: gnews("Chennai") },
  { name: "Google News – TN weather", url: gnews('Tamil Nadu rain OR weather OR IMD OR cyclone OR "Regional Meteorological Centre"') },
  { name: "Google News – TN sports", url: gnews('Tamil Nadu OR Chennai cricket OR football OR kabaddi OR "Chennai Super Kings" OR "Chennaiyin"') },
  { name: "Google News – TN business", url: gnews('Tamil Nadu investment OR industry OR factory OR MoU OR jobs OR startup') },
  { name: "Google News – TN education & health", url: gnews('Tamil Nadu school OR college OR exam OR hospital OR health') },
  { name: "Google News – TN agriculture", url: gnews('Tamil Nadu farmers OR paddy OR Cauvery OR dam OR agriculture') },
];

export const CATEGORIES = [
  "Government",
  "Policy",
  "Weather",
  "Sports",
  "Business",
  "Education",
  "Health",
  "Agriculture",
  "Transport",
  "Law & Order",
  "Technology",
  "Environment",
  "Culture",
  "Politics",
];
