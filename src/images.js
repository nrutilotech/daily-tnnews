// Step 3: find a free-to-use photo for each story from Pixabay (or Pexels, if that key is set).
// Both licences allow commercial use. News-site photos are copyrighted, so they are never reposted.
import { config } from "./config.js";

const CATEGORY_FALLBACK_QUERY = {
  Government: "Chennai secretariat building",
  Policy: "government documents signing",
  Weather: "monsoon rain India",
  Sports: "cricket stadium India",
  Business: "Chennai skyline",
  Education: "Indian students classroom",
  Health: "hospital India",
  Agriculture: "Tamil Nadu paddy field",
  Transport: "Chennai metro train",
  "Law & Order": "police India",
  Technology: "technology office India",
  Environment: "Western Ghats forest",
  Culture: "Tamil Nadu temple",
  Politics: "Indian parliament",
};

// Each search returns { id, url, credit } or null.
async function searchPixabay(query, used) {
  const url = `https://pixabay.com/api/?key=${encodeURIComponent(config.pixabayKey)}&q=${encodeURIComponent(query.slice(0, 100))}&image_type=photo&safesearch=true&per_page=20&min_width=1000`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Pixabay ${res.status}`);
  const data = await res.json();
  // prefer portrait photos, but take any orientation if that's all there is
  const hits = (data.hits ?? []).filter((h) => h.type === "photo" && !used.has("pb" + h.id));
  const p = hits.find((h) => h.imageHeight >= h.imageWidth) ?? hits[0];
  return p && { id: "pb" + p.id, url: p.largeImageURL, credit: `Photo: ${p.user} / Pixabay` };
}

async function searchPexels(query, used) {
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&orientation=portrait&per_page=15&locale=en-US`;
  const res = await fetch(url, { headers: { Authorization: config.pexelsKey }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Pexels ${res.status}`);
  const data = await res.json();
  const p = (data.photos ?? []).find((p) => !used.has("px" + p.id));
  return p && { id: "px" + p.id, url: p.src.large2x, credit: `Photo: ${p.photographer} / Pexels` };
}

export async function findPhotos(stories) {
  const search = config.pixabayKey ? searchPixabay : config.pexelsKey ? searchPexels : null;
  const used = new Set();
  const out = [];
  for (const s of stories) {
    let photo = null;
    if (search) {
      for (const q of [s.image_query, CATEGORY_FALLBACK_QUERY[s.category]].filter(Boolean)) {
        try {
          const p = await search(q, used);
          if (p) {
            used.add(p.id);
            const img = await fetch(p.url, { signal: AbortSignal.timeout(30000) }).then((r) => (r.ok ? r.arrayBuffer() : null));
            if (img) photo = { buffer: Buffer.from(img), credit: p.credit };
            break;
          }
        } catch (e) {
          console.warn(`  photo search "${q}" failed: ${e.message}`);
        }
      }
    }
    out.push(photo); // null → the slide uses a designed colour background instead
  }
  return out;
}
