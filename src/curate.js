// Step 2: Gemini researches the last 12 hours and picks the 10 most important stories.
// Pass 1 uses Google Search grounding to verify and fill gaps; pass 2 turns the brief into strict JSON.
// Both run on the Gemini API free tier (search grounding is free on gemini-2.5-flash, up to 500 a day).
import { z } from "zod";
import { config, CATEGORIES } from "./config.js";

const Story = z.object({
  category: z.enum(CATEGORIES),
  headline: z.string().describe("Punchy slide headline, max ~70 characters, no clickbait"),
  summary: z.string().describe("2–3 short factual sentences, max ~230 characters, original wording"),
  key_fact: z.string().describe("One figure/date/place that matters most, max ~40 characters, or empty string"),
  caption_line: z.string().describe("One-line version for the Instagram caption list, max ~90 characters"),
  source_name: z.string().describe("Publisher the facts come from, e.g. The Hindu"),
  source_url: z.string(),
  image_query: z.string().describe("2–4 English words for a stock photo that fits, e.g. 'Chennai heavy rain street'. Never a person's name."),
});

const Edition = z.object({
  edition_summary: z.string().describe("2–3 sentences: what happened in Tamil Nadu in the last 12 hours"),
  stories: z.array(Story).describe("Exactly 10 stories, most important first; stories[0] is the cover story"),
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
- Write summaries in your own words; never copy sentences from articles.
- Neutral tone, no opinions, no party bias, no sensational language. Do not name victims of crimes or minors.
- Skip stories already covered in the previous posts listed, unless there is a genuinely new development (then say what is new).
${lang}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Gemini's free tier sometimes answers 503 "high demand" or 429 "rate limit". Wait and retry,
// then move on to the backup model, so a busy moment doesn't cost a whole edition.
async function gemini(model, body) {
  const models = [model, ...config.backupModels.filter((m) => m && m !== model)];
  let lastError;
  for (const m of models) {
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        return await geminiOnce(m, body);
      } catch (e) {
        lastError = e;
        if (!/ (429|500|502|503|504):/.test(e.message)) break; // not a temporary error: try the next model
        if (attempt < 4) {
          console.warn(`  ${e.message.slice(0, 120)} — retrying in ${attempt * 20}s`);
          await sleep(attempt * 20000);
        }
      }
    }
    console.warn(`  giving up on ${m}`);
  }
  throw lastError;
}

async function geminiOnce(model, body) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": config.geminiKey },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: systemPrompt() }] }, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gemini ${model} ${res.status}: ${data.error?.message ?? "request failed"}`);
  const cand = data.candidates?.[0];
  const text = (cand?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
  if (!text) throw new Error(`Gemini ${model} returned no text (${cand?.finishReason ?? data.promptFeedback?.blockReason ?? "unknown"})`);
  return text;
}

export async function curate(headlines, history) {
  if (!config.geminiKey) throw new Error("GEMINI_API_KEY is not set");

  const now = new Date().toLocaleString("en-IN", { timeZone: config.timezone, dateStyle: "full", timeStyle: "short" });
  const list = headlines
    .map((h, i) => `${i + 1}. [${h.source}] ${h.title}${h.published ? ` (${h.published})` : ""}${h.snippet ? ` — ${h.snippet}` : ""}\n   ${h.link}`)
    .join("\n");
  const previous = history.flatMap((p) => p.headlines).slice(-40);

  const task = `It is now ${now} (IST). Prepare the Tamil Nadu news brief for the last ${config.windowHours} hours.

Headlines collected from news feeds:
${list || "(feeds returned nothing)"}

Already posted in previous editions (avoid repeating):
${previous.map((h) => "- " + h).join("\n") || "(none)"}

Pick the 10 best stories, most important first. For each give: category, the key facts (who/what/when/where, numbers), the source publisher and URL, and a stock-photo idea.`;

  // Pass 1 — research. Google Search grounding is free only on the older Flash model, so try that first
  // and fall back to working from the feed headlines alone if it is unavailable or over its limit.
  let brief;
  if (!config.researchModel) {
    console.log(`  Gemini (${config.writerModel}): reading the feed headlines…`);
    brief = await gemini(config.writerModel, { contents: [{ role: "user", parts: [{ text: task }] }] });
  } else try {
    console.log(`  Gemini (${config.researchModel} + Google Search): researching…`);
    brief = await gemini(config.researchModel, {
      contents: [{ role: "user", parts: [{ text: task + "\n\nUse Google Search to confirm the important stories and to find anything missing — especially Tamil Nadu government orders/schemes/announcements, the Chennai Regional Meteorological Centre / IMD weather outlook, and sports." }] }],
      tools: [{ google_search: {} }],
    });
  } catch (e) {
    console.warn(`  search research failed (${e.message}); using feed headlines only`);
    brief = await gemini(config.writerModel, { contents: [{ role: "user", parts: [{ text: task }] }] });
  }

  // Pass 2 — structure the brief into slides (JSON output, checked with zod).
  console.log(`  Gemini (${config.writerModel}): writing slides…`);
  const schema = z.toJSONSchema(Edition);
  delete schema.$schema;
  const request = {
    contents: [
      {
        role: "user",
        parts: [{ text: `Here is today's research brief:\n\n${brief}\n\nTurn it into exactly ${config.storyCount} slide stories (most important first) following the editorial rules and the field limits.` }],
      },
    ],
    generationConfig: { responseMimeType: "application/json", responseJsonSchema: schema },
  };
  const raw = await gemini(config.writerModel, request);
  const parsed = Edition.safeParse(JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "")));
  if (!parsed.success) throw new Error(`Gemini's slide JSON did not match the expected format: ${parsed.error.message.slice(0, 300)}`);
  const edition = parsed.data;
  if (edition.stories.length < 5) throw new Error(`Only ${edition.stories.length} stories came back — not posting a thin edition`);
  edition.stories = edition.stories.slice(0, config.storyCount);
  edition.hashtags = [...new Set(edition.hashtags.map((h) => h.replace(/^#/, "").replace(/\s+/g, "")))].slice(0, 15);
  return edition;
}
