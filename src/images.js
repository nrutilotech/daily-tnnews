// Step 3: choose a photo for each story only after reading the full article, and only if it fits.
//   1. Gemini reads each full article and describes what a fitting photo should show (+ search terms).
//      In the same pass it checks the slide text against the article and corrects it if needed.
//   2. Pixabay (free licence, so always tried first) returns candidates,
//      searched inside a matching category, with people/fashion photos filtered out by their tags.
//   3. Gemini looks at the candidate photos next to the article brief and picks one only if it really
//      matches.
//   4. Only if SOURCE_PHOTOS=true (off by default: publishers' photos are copyrighted): when no stock
//      photo fits, the news report's own photo is used, credited to the publisher. Crime stories never use the
//      report's photo (it could show victims or minors); with nothing usable, the slide uses the
//      designed background.
import { z } from "zod";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { config } from "./config.js";
import { askGemini } from "./curate.js";

const NO_SOURCE_PHOTO = new Set(["Law & Order"]);

const CATEGORY_FALLBACK_QUERY = {
  Government: "government office building",
  Policy: "documents signing pen",
  Weather: "monsoon rain clouds",
  Sports: "cricket stadium",
  Business: "city skyline business",
  Education: "classroom school desks",
  Health: "hospital corridor",
  Agriculture: "paddy field farming",
  Transport: "train railway station",
  "Law & Order": "police car lights",
  Technology: "computer technology office",
  Environment: "forest river nature",
  Culture: "hindu temple architecture",
  Politics: "parliament building",
};

// Pixabay's own categories, so a word like "model" in "model registration hubs" can't pull in fashion shots.
const PIXABAY_CATEGORY = {
  Government: "buildings",
  Policy: "business",
  Weather: "nature",
  Sports: "sports",
  Business: "business",
  Education: "education",
  Health: "health",
  Agriculture: "nature",
  Transport: "transportation",
  "Law & Order": "places",
  Technology: "computer",
  Environment: "nature",
  Culture: "places",
  Politics: "buildings",
};

// Never on a news slide.
const ALWAYS_BLOCKED = /\b(model|models|fashion|beauty|beautiful|sexy|lingerie|bikini|swimsuit|glamour|makeup|pose|posing|nude|selfie|wedding|bride|romance|romantic|couple|love|kiss)\b/i;
// People shots are only allowed when the article is genuinely about people doing something visible
// (a match, farmers in a field, a crowd) — Gemini decides that in the brief.
const PEOPLE = /\b(woman|women|girl|girls|man|men|boy|boys|lady|female|male|portrait|face|person|people|child|children|kid|kids|baby)\b/i;
const STOP = new Set(["and", "the", "for", "with", "new", "tamil", "nadu", "chennai", "india", "indian", "public", "model", "state", "hub", "hubs", "star"]);
const keywords = (q) => String(q).toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2 && !STOP.has(w));

const Brief = z.object({
  briefs: z.array(
    z.object({
      story: z.number().int().describe("Story number as given"),
      subject: z.string().describe("A GENERIC scene a stock photo library would have that illustrates the article's theme, e.g. 'stormy sea and dark clouds' for a cyclone warning, 'sacks of onions at a market' for onion prices, 'university building' for a university story. Not the exact place or event."),
      queries: z.array(z.string()).describe("2–3 stock-photo searches, 1–3 generic English words each (objects, places, weather, nature), most fitting first, e.g. 'stormy sea', 'onions market', 'check dam water'"),
      people_ok: z.boolean().describe("true only if the article is about people visibly doing something (sport, farming, a crowd); never for portraits"),
      summary: z.string().describe("The slide summary, corrected if the article says otherwise; same length limits; else repeat it unchanged"),
      key_fact: z.string().describe("The key fact, corrected from the article if needed; empty string if none"),
    }),
  ),
});

const Pick = z.object({
  picks: z.array(
    z.object({
      story: z.number().int(),
      photo: z.number().int().describe("Number of the photo that fits, or 0 if none fits"),
      reason: z.string().describe("Short reason"),
    }),
  ),
});

const schemaOf = (zod) => {
  const s = z.toJSONSchema(zod);
  delete s.$schema;
  return s;
};
const json = (zod) => (raw) => {
  const parsed = zod.safeParse(JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "")));
  if (!parsed.success) throw new Error(`returned JSON in the wrong shape: ${parsed.error.message.slice(0, 160)}`);
  return parsed.data;
};

// 1. Read the articles; brief each photo; correct slide text that the article contradicts.
async function writeBriefs(stories) {
  const list = stories
    .map(
      (s, i) => `### Story ${i + 1} [${s.category}]
Headline: ${s.headline}
Slide summary: ${s.summary}
Key fact: ${s.key_fact || "(none)"}
Full article (${s.source_name}):
${s.article_text || "(the article could not be read — use the headline and summary only)"}`,
    )
    .join("\n\n");
  const result = await askGemini(
    {
      systemInstruction: {
        parts: [
          {
            text: "You are the photo editor and fact-checker of a Tamil Nadu news page. Read each full article carefully before deciding anything. Photos are illustrative stock photos, so describe a generic place, object or scene that illustrates the article's theme — the kind of photo any stock library has. Never a specific named person, never portraits, never a specific foreign landmark, and never anything that could mislead readers about what happened.",
          },
        ],
      },
      contents: [{ role: "user", parts: [{ text: `For each story below, read the full article, then:\n- describe what a fitting illustrative photo shows and give 2–3 short search terms;\n- check the slide summary and key fact against the article. If the article contradicts them or they add facts not in it, rewrite them from the article in the same language as the slide text (summary max ~200 characters, key fact max ~40). Otherwise repeat them unchanged.\n\n${list}` }] }],
      generationConfig: { responseMimeType: "application/json", responseJsonSchema: schemaOf(Brief) },
    },
    json(Brief),
  );
  return stories.map((_, i) => result.briefs.find((b) => b.story === i + 1) ?? null);
}

// 2. Candidate photos for one story.
async function candidates(story, brief, used) {
  const category = PIXABAY_CATEGORY[story.category];
  const searches = [
    ...(brief?.queries ?? []).map((q) => [q, category]),
    ...(brief?.queries ?? []).slice(0, 1).map((q) => [q, null]),
    [CATEGORY_FALLBACK_QUERY[story.category], category],
  ];
  const found = [];
  for (const [q, cat] of searches) {
    if (found.length >= 4) break;
    const words = keywords(q);
    if (!words.length) continue;
    const url = `https://pixabay.com/api/?key=${encodeURIComponent(config.pixabayKey)}&q=${encodeURIComponent(words.join(" ").slice(0, 100))}&image_type=photo&safesearch=true&per_page=20&min_width=1000${cat ? `&category=${cat}` : ""}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`Pixabay ${res.status}`);
      for (const h of (await res.json()).hits ?? []) {
        if (found.length >= 4) break;
        const tags = h.tags ?? "";
        if (h.type !== "photo" || used.has(h.id) || found.some((f) => f.id === h.id)) continue;
        if (ALWAYS_BLOCKED.test(tags) || (!brief?.people_ok && PEOPLE.test(tags))) continue;
        found.push({ id: h.id, preview: h.webformatURL, full: h.largeImageURL, tags, credit: `Photo: ${h.user} / Pixabay`, portrait: h.imageHeight >= h.imageWidth });
      }
    } catch (e) {
      console.warn(`  photo search "${q}" failed: ${e.message}`);
    }
  }
  return found;
}

async function download(url, ms = 30000, headers = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// 3. Gemini looks at every candidate and picks the one that fits each article (or none).
// Small backup models sometimes skip stories in a long request, so the skipped ones are asked again
// in small groups.
async function pickPhotos(stories, briefs, cands) {
  const picks = stories.map((_, i) => (cands[i].length ? null : { photo: 0, reason: "no candidate photos found" }));
  const waiting = () => picks.flatMap((p, i) => (p ? [] : [i]));
  for (const p of await askPicks(stories, briefs, cands, waiting())) picks[p.index] = p;
  const again = waiting();
  if (again.length) {
    console.log(`  ${again.length} stor${again.length === 1 ? "y was" : "ies were"} skipped — asking again for those`);
    for (let k = 0; k < again.length; k += 3) {
      try {
        for (const p of await askPicks(stories, briefs, cands, again.slice(k, k + 3))) picks[p.index] = p;
      } catch (e) {
        console.warn(`  second photo check failed (${e.message.slice(0, 120)})`);
      }
    }
  }
  return picks.map((p) => p ?? { photo: 0, reason: "not answered" });
}

// One photo-check request for the stories at the given indexes. Returns [{ index, photo, reason }].
async function askPicks(stories, briefs, cands, indexes) {
  if (!indexes.length) return [];
  const parts = [
    {
      text: `You are choosing illustrative stock photos for news slides. These are NOT photos of the actual event and do not need to show the exact place: a photo fits if it is a reasonable, honest illustration of the story's theme (any stormy sea for a cyclone warning, any onions for onion prices, a generic campus for a university story). The news is from Tamil Nadu, India, so a photo must look like it could plausibly be there. For each story pick the best fitting photo, or 0 if none is a reasonable illustration. For stories about political statements, criticism or party campaigns a stock photo rarely fits: choose 0 unless a photo clearly illustrates the topic (for example a gavel for a court ruling). Reject a photo (never pick it) if it: is unrelated to the theme; shows snow, ice or alpine mountains; shows European, American or East Asian streets, buildings, markets, trains, vehicles or landscapes that look clearly foreign; shows people when people are not allowed; is sexual, glamour or fashion-like; shows a recognisable foreign landmark, flag, signage or text that would mislead; or looks like a real photo of a specific different event (an accident, a protest, a ceremony).`,
    },
  ];
  for (const i of indexes) {
    const s = stories[i];
    parts.push({ text: `\n### Story ${i + 1}: ${s.headline}\nPhoto should show: ${briefs[i]?.subject ?? s.headline}\nPeople allowed: ${briefs[i]?.people_ok ? "yes" : "no"}` });
    for (const [k, c] of cands[i].entries()) {
      parts.push({ text: `Story ${i + 1}, photo ${k + 1}:` });
      parts.push({ inline_data: { mime_type: "image/jpeg", data: c.data.toString("base64") } });
    }
  }
  const result = await askGemini(
    {
      systemInstruction: { parts: [{ text: "You are a careful photo editor for a news page. Accuracy matters more than having a photo." }] },
      contents: [{ role: "user", parts }],
      generationConfig: { responseMimeType: "application/json", responseJsonSchema: schemaOf(Pick) },
    },
    json(Pick),
  );
  return indexes.flatMap((i) => {
    const p = result.picks.find((x) => x.story === i + 1);
    return p ? [{ index: i, photo: p.photo, reason: p.reason }] : [];
  });
}

// A logo card or plain graphic (e.g. a site's "no photo" image) rather than a photo: one flat colour
// covers most of it.
function looksLikeGraphic(img) {
  const ctx = createCanvas(32, 32).getContext("2d");
  ctx.drawImage(img, 0, 0, 32, 32);
  const d = ctx.getImageData(0, 0, 32, 32).data;
  const counts = new Map();
  for (let i = 0; i < d.length; i += 4) {
    const key = `${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Math.max(...counts.values()) / 1024 > 0.5;
}

// The photo from the news report itself, credited to the publisher (step 4).
// Returns { photo } or { why } (the reason there is none, for the log).
async function sourcePhoto(story) {
  if (!config.sourcePhotos) return { why: "news photos are turned off" };
  if (NO_SOURCE_PHOTO.has(story.category)) return { why: "crime story, so the report's photo isn't used" };
  if (!story.source_image) return { why: "the report has no photo, or it couldn't be read" };
  try {
    const buffer = await download(story.source_image, 20000, { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36" });
    const img = await loadImage(buffer);
    // too small to fill a slide, a banner/strip rather than a photo, or a logo card
    if (img.width < 600 || img.height < 320 || img.width / img.height > 2.4 || img.height / img.width > 1.8) return { why: `the report's photo is too small or an odd shape (${img.width}×${img.height})` };
    if (looksLikeGraphic(img)) return { why: "the report's image is a logo or graphic" };
    const publisher = String(story.source_name ?? "").replace(/\s+[–-]\s+.*$/, "").trim() || new URL(story.source_url).hostname.replace(/^www\./, "");
    return { photo: { buffer, credit: `Photo: ${publisher}` } };
  } catch (e) {
    return { why: `the report's photo couldn't be loaded (${e.message.slice(0, 60)})` };
  }
}

export async function findPhotos(stories) {
  const photos = config.pixabayKey ? await stockPhotos(stories) : stories.map(() => null);
  // the same image on two different reports is a site's default picture, not a news photo
  const seen = stories.map((s) => s.source_image).filter(Boolean);
  const isDefault = (u) => seen.filter((x) => x === u).length > 1;
  for (const [i, s] of stories.entries()) {
    if (photos[i]) continue;
    const r = isDefault(s.source_image) ? { why: "the report's image is the site's default picture" } : await sourcePhoto(s);
    photos[i] = r.photo ?? null;
    console.log(`  story ${i + 1}: ${r.photo ? `the report's own photo (${r.photo.credit})` : `designed background — ${r.why}`}`);
  }
  return photos;
}

async function stockPhotos(stories) {
  let briefs;
  try {
    console.log("  reading the full articles to brief the photos…");
    briefs = await writeBriefs(stories);
    // apply corrections from the article check
    for (const [i, b] of briefs.entries()) {
      const s = stories[i];
      if (!b || !s.article_text) continue;
      if (b.summary && b.summary.trim() !== s.summary.trim()) {
        console.log(`  story ${i + 1}: summary corrected from the full article`);
        s.summary = b.summary.trim();
      }
      if (typeof b.key_fact === "string" && b.key_fact.trim() !== (s.key_fact ?? "").trim()) s.key_fact = b.key_fact.trim();
    }
  } catch (e) {
    console.warn(`  could not brief the photos (${e.message.slice(0, 120)}) — no stock photos this time`);
    return stories.map(() => null);
  }

  const used = new Set();
  const cands = [];
  for (const [i, s] of stories.entries()) {
    const list = await candidates(s, briefs[i], used);
    for (const c of list) {
      try {
        c.data = await download(c.preview, 20000);
      } catch {
        c.data = null;
      }
    }
    cands.push(list.filter((c) => c.data));
    list.forEach((c) => used.add(c.id));
  }

  let picks;
  try {
    console.log("  checking candidate photos against each article…");
    picks = await pickPhotos(stories, briefs, cands);
  } catch (e) {
    console.warn(`  photo check failed (${e.message.slice(0, 120)}) — no stock photos this time`);
    return stories.map(() => null);
  }

  const photos = [];
  for (const [i, pick] of picks.entries()) {
    const c = cands[i][pick.photo - 1];
    if (!c) {
      console.log(`  story ${i + 1}: no stock photo fits (${pick.reason})`);
      photos.push(null);
      continue;
    }
    try {
      photos.push({ buffer: await download(c.full), credit: c.credit });
      console.log(`  story ${i + 1}: photo ${pick.photo} — ${pick.reason}`);
    } catch {
      photos.push(null);
    }
  }
  return photos;
}
