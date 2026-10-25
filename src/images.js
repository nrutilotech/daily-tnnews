// Step 3: find a free-to-use photo for each story (Pexels licence allows commercial use).
// News-site photos are copyrighted, so they are never downloaded or reposted.
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

async function searchPexels(query, used) {
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&orientation=portrait&per_page=15&locale=en-US`;
  const res = await fetch(url, { headers: { Authorization: config.pexelsKey } });
  if (!res.ok) throw new Error(`Pexels ${res.status}`);
  const data = await res.json();
  return (data.photos ?? []).find((p) => !used.has(p.id));
}

export async function findPhotos(stories) {
  const used = new Set();
  const out = [];
  for (const s of stories) {
    let photo = null;
    if (config.pexelsKey) {
      for (const q of [s.image_query, CATEGORY_FALLBACK_QUERY[s.category]].filter(Boolean)) {
        try {
          const p = await searchPexels(q, used);
          if (p) {
            used.add(p.id);
            const img = await fetch(p.src.large2x).then((r) => (r.ok ? r.arrayBuffer() : null));
            if (img) photo = { buffer: Buffer.from(img), credit: `Photo: ${p.photographer} / Pexels` };
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
