// Step 3: find a free-to-use photo for each story from Pixabay (or Pexels, if that key is set).
// Both licences allow commercial use. News-site photos are copyrighted, so they are never reposted.
// News slides should show places and things, not random people, so searches are kept inside a
// matching Pixabay category, people/fashion photos are rejected, and the photo's tags must match.
import { config } from "./config.js";

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

// Photos tagged with any of these are never used on a news slide.
const BLOCKED_TAGS = /\b(woman|women|girl|girls|man|men|boy|model|models|fashion|beauty|beautiful|sexy|lingerie|bikini|swimsuit|portrait|female|male|lady|makeup|glamour|pose|posing|body|people|person|couple|love|selfie|face|child|kid|baby|wedding|bride|nude)\b/i;
const STOP = new Set(["and", "the", "for", "with", "new", "tamil", "nadu", "chennai", "india", "indian", "public", "model", "state"]);
const keywords = (q) => q.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2 && !STOP.has(w));

function acceptable(tags, query, needMatch) {
  if (BLOCKED_TAGS.test(tags)) return false;
  if (!needMatch) return true;
  const t = tags.toLowerCase();
  return keywords(query).some((w) => t.includes(w.replace(/s$/, "")));
}

// Each search returns { id, url, credit } or null.
async function searchPixabay(query, used, { category, needMatch }) {
  const q = keywords(query).join(" ").slice(0, 100) || query;
  const url = `https://pixabay.com/api/?key=${encodeURIComponent(config.pixabayKey)}&q=${encodeURIComponent(q)}&image_type=photo&safesearch=true&per_page=30&min_width=1000${category ? `&category=${category}` : ""}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Pixabay ${res.status}`);
  const data = await res.json();
  const hits = (data.hits ?? []).filter((h) => h.type === "photo" && !used.has("pb" + h.id) && acceptable(h.tags ?? "", query, needMatch));
  // prefer portrait photos, but take any orientation if that's all there is
  const p = hits.find((h) => h.imageHeight >= h.imageWidth) ?? hits[0];
  return p && { id: "pb" + p.id, url: p.largeImageURL, credit: `Photo: ${p.user} / Pixabay` };
}

async function searchPexels(query, used) {
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(keywords(query).join(" ") || query)}&orientation=portrait&per_page=15&locale=en-US`;
  const res = await fetch(url, { headers: { Authorization: config.pexelsKey }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Pexels ${res.status}`);
  const data = await res.json();
  const p = (data.photos ?? []).find((p) => !used.has("px" + p.id) && !BLOCKED_TAGS.test(p.alt ?? ""));
  return p && { id: "px" + p.id, url: p.src.large2x, credit: `Photo: ${p.photographer} / Pexels` };
}

export async function findPhotos(stories) {
  const used = new Set();
  const out = [];
  for (const s of stories) {
    const category = PIXABAY_CATEGORY[s.category];
    const fallback = CATEGORY_FALLBACK_QUERY[s.category];
    // most specific first; the generic category photo is the last resort
    const attempts = config.pixabayKey
      ? [
          [s.image_query, { category, needMatch: true }],
          [s.image_query, { category: null, needMatch: true }],
          [fallback, { category, needMatch: false }],
        ]
      : config.pexelsKey
        ? [[s.image_query], [fallback]]
        : [];
    let photo = null;
    for (const [q, opts] of attempts) {
      if (!q) continue;
      try {
        const p = config.pixabayKey ? await searchPixabay(q, used, opts) : await searchPexels(q, used);
        if (!p) continue;
        const img = await fetch(p.url, { signal: AbortSignal.timeout(30000) }).then((r) => (r.ok ? r.arrayBuffer() : null));
        if (img) {
          used.add(p.id);
          photo = { buffer: Buffer.from(img), credit: p.credit };
          break;
        }
      } catch (e) {
        console.warn(`  photo search "${q}" failed: ${e.message}`);
      }
    }
    out.push(photo); // null → the slide uses a designed colour background instead
  }
  return out;
}
