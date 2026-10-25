// Step 2: Claude researches the last 12 hours and picks the 10 most important stories.
// Pass 1 uses web search to verify and fill gaps; pass 2 turns the brief into strict JSON.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { config, CATEGORIES } from "./config.js";

const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };

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
- Every fact must come from a credible source you saw (the provided headlines or your web search). Never invent numbers, quotes or names. If something is unconfirmed, leave it out.
- Write summaries in your own words; never copy sentences from articles.
- Neutral tone, no opinions, no party bias, no sensational language. Do not name victims of crimes or minors.
- Skip stories already covered in the previous posts listed, unless there is a genuinely new development (then say what is new).
${lang}`;
}

function extractText(content) {
  return content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
}

function checkStop(resp, step) {
  if (resp.stop_reason === "refusal") {
    throw new Error(`Claude declined the ${step} step (${resp.stop_details?.category ?? "no category"})`);
  }
  if (resp.stop_reason === "max_tokens") throw new Error(`Claude ran out of output tokens in the ${step} step`);
}

export async function curate(headlines, history) {
  if (!config.anthropicKey) throw new Error("ANTHROPIC_API_KEY is not set");
  const client = new Anthropic({ apiKey: config.anthropicKey });

  const now = new Date().toLocaleString("en-IN", { timeZone: config.timezone, dateStyle: "full", timeStyle: "short" });
  const list = headlines
    .map((h, i) => `${i + 1}. [${h.source}] ${h.title}${h.published ? ` (${h.published})` : ""}${h.snippet ? ` — ${h.snippet}` : ""}\n   ${h.link}`)
    .join("\n");
  const previous = history.flatMap((p) => p.headlines).slice(-40);

  const userMsg = {
    role: "user",
    content: `It is now ${now} (IST). Prepare the Tamil Nadu news brief for the last ${config.windowHours} hours.

Headlines collected from news feeds:
${list || "(feeds returned nothing — rely on web search)"}

Already posted in previous editions (avoid repeating):
${previous.map((h) => "- " + h).join("\n") || "(none)"}

Use web search to confirm the important stories and to find anything missing — especially Tamil Nadu government orders/schemes/announcements, the Chennai Regional Meteorological Centre / IMD weather outlook, and sports. Then write a brief of the 10 best stories, most important first. For each give: category, the key facts (who/what/when/where, numbers), the source publisher and URL, and a stock-photo idea.`,
  };

  // Pass 1 — research with web search. Server tools can pause long turns; resume them.
  console.log("  Claude: researching…");
  const tools = [
    {
      type: "web_search_20260209",
      name: "web_search",
      max_uses: 12,
      user_location: { type: "approximate", city: "Chennai", region: "Tamil Nadu", country: "IN", timezone: config.timezone },
    },
  ];
  let assistantContent = [];
  let resp;
  for (let i = 0; i < 5; i++) {
    const messages = assistantContent.length ? [userMsg, { role: "assistant", content: assistantContent }] : [userMsg];
    resp = await client.beta.messages.create({
      model: config.model,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system: systemPrompt(),
      tools,
      messages,
      ...FALLBACK,
    });
    checkStop(resp, "research");
    assistantContent = [...assistantContent, ...resp.content];
    if (resp.stop_reason !== "pause_turn") break;
  }
  const brief = extractText(assistantContent);
  if (!brief) throw new Error("Claude returned an empty research brief");

  // Pass 2 — structure the brief into slides.
  console.log("  Claude: writing slides…");
  const parsed = await client.beta.messages.parse({
    model: config.model,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: "low", format: betaZodOutputFormat(Edition) },
    system: systemPrompt(),
    messages: [
      {
        role: "user",
        content: `Here is today's research brief:\n\n${brief}\n\nTurn it into exactly ${config.storyCount} slide stories (most important first) following the editorial rules and the field limits.`,
      },
    ],
    ...FALLBACK,
  });
  checkStop(parsed, "writing");
  const edition = parsed.parsed_output;
  if (!edition) throw new Error("Could not parse Claude's structured output");
  if (edition.stories.length < 5) throw new Error(`Only ${edition.stories.length} stories came back — not posting a thin edition`);
  edition.stories = edition.stories.slice(0, config.storyCount);
  edition.hashtags = [...new Set(edition.hashtags.map((h) => h.replace(/^#/, "").replace(/\s+/g, "")))].slice(0, 15);
  return edition;
}
