// Step 2: Gemini reads the last 12 hours of headlines and picks the 10 most important stories.
// One call returns the slides as JSON (checked with zod). If GEMINI_RESEARCH_MODEL is set (a model
// with Google Search grounding, which isn't free for new users), a research pass runs first.
import { z } from "zod";
import { config, CATEGORIES } from "./config.js";

const Story = z.object({
  category: z.enum(CATEGORIES),
  headline: z.string().describe("Punchy slide headline, max ~70 characters, no clickbait"),
  summary: z.string().describe("2–3 short factual sentences, max ~200 characters, original wording; add detail beyond the headline"),
  key_fact: z.string().describe("One extra figure/date/place NOT already in the headline (e.g. 'Red alert: Madurai, Theni'), max ~40 characters; empty string if nothing new to add"),
  caption_line: z.string().describe("One-line version for the Instagram caption list, max ~90 characters"),
  source_name: z.string().describe("Publisher the facts come from, exactly as shown in the headline list, e.g. The Hindu"),
  source_number: z.number().int().describe("The number of the headline in the list above that this story is mainly based on"),
  image_query: z.string().describe("2–4 English words describing a PLACE or OBJECT for a stock photo, e.g. 'government office counter', 'heavy rain street', 'paddy field'. Never people, faces, names, or ambiguous words like 'model', 'hub' or 'star'."),
});

const Edition = z.object({
  edition_summary: z.string().describe("2–3 sentences: what happened in Tamil Nadu in the last 12 hours"),
  stories: z.array(Story).describe("12 different stories, most important first; stories[0] is the cover story"),
  hashtags: z.array(z.string()).describe("10–15 relevant hashtags without the # sign"),
});

function systemPrompt() {
  const lang =
    config.language === "ta"
      ? "Write headline, summary, key_fact, caption_line and edition_summary in clear, simple Tamil (தமிழ்). image_query stays in English."
      : "Write everything in clear, simple Indian English.";
  return `You are the news editor of "${config.brand}", an Instagram page that posts a 10-story carousel of Tamil Nadu news every 12 hours.

Editorial rules:
- Only include events reported in the last ${config.windowHours} hours that relate to Tamil Nadu (state, districts, Chennai, or national decisions that clearly affect TN).
- Rank by public importance. Aim for a mix: government announcements and policies first, then weather, sports, business/industry, education, health, agriculture, transport and other sectors. Include a weather story if there is any forecast, alert or rain news. Avoid filling the list with politics or crime.
- Every fact must come from a credible source you saw (the provided headlines or your search results). Never invent numbers, quotes or names. If something is unconfirmed, leave it out.
- Each story must be a different event. Merge reports of the same event from different outlets into one story.
- Write summaries in your own words; never copy sentences from articles.
- Neutral tone, no opinions, no party bias, no sensational language. Do not name victims of crimes or minors.
- Skip stories already covered in the previous posts listed, unless there is a genuinely new development (then say what is new).
${lang}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TEMPORARY = / (429|500|502|503|504):/;

// The free-tier models are often busy (503) or rate-limited (429). Each model gets a couple of quick
// tries, then the next model in the list takes over; a timeout or a bad answer moves on at once.
// `check` turns the raw text into the result and throws if it is unusable.
async function gemini(body, check, models) {
  let lastError;
  for (const [n, m] of models.entries()) {
    const attempts = n === models.length - 1 ? 3 : 2;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const result = check(await geminiOnce(m, body));
        if (n > 0) console.log(`  (answered by backup model ${m})`);
        return result;
      } catch (e) {
        lastError = e;
        if (!TEMPORARY.test(e.message) || attempt === attempts) {
          console.warn(`  ${m}: ${e.message.slice(0, 140)} — trying the next model`);
          break;
        }
        console.warn(`  ${m}: busy — retrying in ${attempt * 15}s`);
        await sleep(attempt * 15000);
      }
    }
  }
  throw lastError;
}

// The same retry/backup behaviour for other steps (photo briefs, the photo check).
export function askGemini(body, check) {
  return gemini(body, check, [config.writerModel, ...config.backupModels.filter((m) => m && m !== config.writerModel)]);
}

async function geminiOnce(model, body) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": config.geminiKey },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: systemPrompt() }] }, ...body }),
    signal: AbortSignal.timeout(120000),
  }).catch((e) => {
    throw new Error(e.name === "TimeoutError" ? `Gemini ${model} timed out after 120s` : `Gemini ${model}: ${e.message}`);
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gemini ${model} ${res.status}: ${data.error?.message ?? "request failed"}`);
  const cand = data.candidates?.[0];
  const text = (cand?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
  if (!text) throw new Error(`Gemini ${model} returned no text (${cand?.finishReason ?? data.promptFeedback?.blockReason ?? "unknown"})`);
  return text;
}

// Words that identify a story, for spotting repeats of earlier posts.
const STOP = new Set("with from that this have been over into after their about amid says said will tamil nadu chennai govt government state".split(" "));
const words = (t) => new Set(t.toLowerCase().replace(/[^a-z0-9஀-௿ ]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w)));
function isRepeat(headline, previous) {
  const a = words(headline);
  return previous.some((p) => {
    const b = words(p);
    const shared = [...a].filter((w) => b.has(w)).length;
    return shared >= 3 && shared / Math.min(a.size, b.size) >= 0.5;
  });
}

// Parse and validate the slide JSON; small slips (an unknown category, a stray "#") are repaired.
function parseEdition(raw, previous = [], headlines = []) {
  let json;
  try {
    json = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new Error("returned invalid JSON");
  }
  for (const s of json?.stories ?? []) {
    if (!CATEGORIES.includes(s.category)) s.category = CATEGORIES.find((c) => c.toLowerCase() === String(s.category).toLowerCase()) ?? "Government";
  }
  const parsed = Edition.safeParse(json);
  if (!parsed.success) throw new Error(`returned JSON in the wrong shape: ${parsed.error.message.slice(0, 200)}`);
  const edition = parsed.data;
  // drop exact repeats of the same headline
  const seen = new Set();
  edition.stories = edition.stories.filter((s) => !seen.has(s.headline.toLowerCase()) && seen.add(s.headline.toLowerCase()));
  if (edition.stories.length < 5) throw new Error(`returned only ${edition.stories.length} stories`);
  // Prefer fresh stories: repeats of earlier posts are only used if there aren't enough new ones.
  const fresh = edition.stories.filter((s) => !isRepeat(s.headline, previous));
  const repeats = edition.stories.filter((s) => isRepeat(s.headline, previous));
  if (repeats.length) console.log(`  set aside ${repeats.length} story(ies) already posted: ${repeats.map((s) => s.headline).join(" | ")}`);
  edition.stories = [...fresh, ...repeats].slice(0, config.storyCount);
  edition.hashtags = [...new Set(edition.hashtags.map((h) => h.replace(/^#/, "").replace(/\s+/g, "")).filter(Boolean))].slice(0, 15);
  // Link each story to the real article it came from (taken from the feed, never written by the AI).
  for (const st of edition.stories) {
    const h = headlines[st.source_number - 1];
    st.source_url = h?.link || `https://news.google.com/search?q=${encodeURIComponent(st.headline)}&hl=en-IN&gl=IN&ceid=IN:en`;
    if (h && !st.source_name) st.source_name = h.source;
  }
  return edition;
}

export async function curate(headlines, history) {
  if (!config.geminiKey) throw new Error("GEMINI_API_KEY is not set");

  const now = new Date().toLocaleString("en-IN", { timeZone: config.timezone, dateStyle: "full", timeStyle: "short" });
  const list = headlines
    .map((h, i) => `${i + 1}. [${h.source}] ${h.title}${h.published ? ` (${h.published})` : ""}${h.snippet ? ` — ${h.snippet}` : ""}\n   ${h.link}`)
    .join("\n");
  const previous = history.flatMap((p) => p.headlines).slice(-40);

  const task = `It is now ${now} (IST). Prepare the Tamil Nadu news edition for the last ${config.windowHours} hours.

Headlines collected from news feeds:
${list || "(feeds returned nothing)"}

Already posted in previous editions (avoid repeating):
${previous.map((h) => "- " + h).join("\n") || "(none)"}`;

  const models = [config.writerModel, ...config.backupModels.filter((m) => m && m !== config.writerModel)];

  // Optional research pass with Google Search (only when a model for it is configured).
  let input = task;
  if (config.researchModel) {
    try {
      console.log(`  Gemini (${config.researchModel} + Google Search): researching…`);
      const brief = await gemini(
        {
          contents: [{ role: "user", parts: [{ text: `${task}\n\nUse Google Search to confirm the important stories and to find anything missing — especially Tamil Nadu government orders/schemes/announcements, the Chennai Regional Meteorological Centre / IMD weather outlook, and sports. Then write a brief of the 10 best stories with their key facts and sources.` }] }],
          tools: [{ google_search: {} }],
        },
        (t) => t,
        [config.researchModel],
      );
      input = `${task}\n\nResearch brief (checked with Google Search):\n${brief}`;
    } catch (e) {
      console.warn(`  search research failed (${e.message.slice(0, 140)}); using feed headlines only`);
    }
  }

  console.log(`  Gemini (${models[0]}): choosing and writing the ${config.storyCount} stories…`);
  const schema = z.toJSONSchema(Edition);
  delete schema.$schema;
  return gemini(
    {
      contents: [{ role: "user", parts: [{ text: `${input}\n\nPick the 12 best stories, most important first, and write them following the editorial rules and the field limits.` }] }],
      generationConfig: { responseMimeType: "application/json", responseJsonSchema: schema },
    },
    (raw) => parseEdition(raw, previous, headlines),
    models,
  );
}
