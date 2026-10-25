// Threads (Instagram's sister app): links there ARE clickable. Each edition becomes a thread:
//   post 1  – the 10 slides as a carousel + the edition summary
//   replies – one per story: headline, short summary and a clickable link to the original report
// Needs a Threads account for the page and a Threads access token (THREADS_ACCESS_TOKEN); see README.
import { config } from "./config.js";

const base = () => `https://${config.threadsHost}/v1.0`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_BYTES = 490; // Threads allows 500 characters; counted conservatively (emoji take several)

// Trim text to fit, cutting the given field first (so headlines and links stay whole).
export function fitText(parts, cutIndex) {
  const join = (p) => p.filter(Boolean).join("\n\n");
  const p = [...parts];
  while (Buffer.byteLength(join(p)) > MAX_BYTES && p[cutIndex]) {
    p[cutIndex] = p[cutIndex].length > 40 ? p[cutIndex].slice(0, Math.floor(p[cutIndex].length * 0.85)).replace(/\s+\S*$/, "") + "…" : "";
  }
  let t = join(p);
  while (Buffer.byteLength(t) > MAX_BYTES) t = t.slice(0, -2) + "…";
  return t;
}

async function call(method, pathname, params = {}, tries = 3, once = false) {
  for (let attempt = 1; ; attempt++) {
    const body = new URLSearchParams({ ...params, access_token: config.threadsToken });
    let res, data, noAnswer = false;
    try {
      res = await fetch(method === "GET" ? `${base()}/${pathname}?${body}` : `${base()}/${pathname}`, {
        method,
        body: method === "GET" ? undefined : body,
        signal: AbortSignal.timeout(60000),
      });
      data = await res.json().catch(() => ({}));
    } catch (e) {
      noAnswer = true;
      data = { error: { message: e.name === "TimeoutError" ? "timed out" : e.message, is_transient: true } };
    }
    if (res?.ok && !data.error) return data;
    const err = data.error ?? {};
    const transient = err.is_transient || (res && res.status >= 500) || [1, 2, 4, 17, 32, 613].includes(err.code);
    if (!transient || attempt >= tries || (once && noAnswer)) throw new Error(`Threads ${pathname}: ${err.message ?? res?.status}`);
    await sleep(attempt * 10000);
  }
}

async function waitFinished(id, label) {
  for (let i = 0; i < 40; i++) {
    const { status, error_message } = await call("GET", id, { fields: "status,error_message" });
    if (status === "FINISHED") return;
    if (status === "ERROR" || status === "EXPIRED") throw new Error(`${label} failed: ${error_message ?? status}`);
    await sleep(3000);
  }
  throw new Error(`${label} not ready after 2 minutes`);
}

async function create(uid, params, label) {
  const { id } = await call("POST", `${uid}/threads`, params);
  await waitFinished(id, label);
  return id;
}

async function publish(uid, creationId) {
  // never repeat a publish that may have gone through (no double posts)
  const { id } = await call("POST", `${uid}/threads_publish`, { creation_id: creationId }, 4, true);
  return id;
}

export async function threadsUserId() {
  if (config.threadsUserId) return config.threadsUserId;
  const { id } = await call("GET", "me", { fields: "id,username" });
  return id;
}

// Builds the texts for an edition (exported for tests).
export function threadTexts(p, { pageUrl = config.pageUrl } = {}) {
  const intro = fitText(
    [
      `📰 ${config.brand} | ${p.dateLabel} · ${p.editionLabel}`,
      `Tamil Nadu in the last ${config.windowHours} hours: ${p.edition.edition_summary}`,
      `🧵 All ${p.edition.stories.length} stories with links to the full reports below 👇`,
      pageUrl ? `🔗 ${pageUrl}` : "",
    ],
    1,
  );
  const replies = p.edition.stories.map((s, i) => ({
    text: fitText([`${i + 1}. ${s.headline}`, s.summary, `🔗 Full story (${s.source_name}): ${s.source_url}`], 1),
    link: /^https?:\/\//.test(s.source_url ?? "") ? s.source_url : null,
  }));
  return { intro, replies };
}

// Posts the edition as a thread. Returns { permalink, posted } (posted = number of replies published).
export async function postEditionToThreads(p, imageUrls) {
  if (!config.threadsToken) throw new Error("THREADS_ACCESS_TOKEN is not set");
  const uid = await threadsUserId();
  const { intro, replies } = threadTexts(p);

  // 1. carousel of the slides with the intro text (falls back to a text post if images fail)
  let rootContainer;
  try {
    const children = [];
    for (const url of imageUrls.slice(0, 20)) children.push(await create(uid, { media_type: "IMAGE", image_url: url, is_carousel_item: "true" }, "slide"));
    rootContainer = await create(uid, { media_type: "CAROUSEL", children: children.join(","), text: intro }, "carousel");
  } catch (e) {
    console.log(`  Threads carousel failed (${e.message.slice(0, 120)}); posting the intro as text`);
    rootContainer = await create(uid, { media_type: "TEXT", text: intro }, "intro");
  }
  const rootId = await publish(uid, rootContainer);
  console.log("  Threads: posted the edition");

  // 2. one reply per story, each answering the previous one so they read as a single thread
  let prev = rootId;
  let posted = 0;
  for (const [i, r] of replies.entries()) {
    try {
      const c = await create(uid, { media_type: "TEXT", text: r.text, reply_to_id: prev, ...(r.link ? { link_attachment: r.link } : {}) }, `story ${i + 1}`);
      prev = await publish(uid, c);
      posted++;
    } catch (e) {
      console.log(`  Threads: story ${i + 1} failed (${e.message.slice(0, 120)})`);
    }
  }
  const { permalink } = await call("GET", rootId, { fields: "permalink" }, 2).catch(() => ({}));
  return { permalink, posted };
}

// Long-lived Threads tokens last 60 days; refreshing (once the token is 24 h old) gives a fresh 60 days.
export async function refreshThreadsToken() {
  const res = await fetch(`https://${config.threadsHost}/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(config.threadsToken)}`, {
    signal: AbortSignal.timeout(60000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error || !data.access_token) throw new Error(`Threads token refresh failed: ${data.error?.message ?? res.status}`);
  return data;
}
