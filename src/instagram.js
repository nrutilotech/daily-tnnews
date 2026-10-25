// Step 5: publish the slides as one Instagram carousel via the official Graph API.
// Instagram downloads each image from a public URL, so the slides must be hosted first.
import { config } from "./config.js";

const base = () => `https://${config.igHost}/${config.igApiVersion}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class IgError extends Error {
  constructor(message, transient, noAnswer = false) {
    super(message);
    this.transient = transient;
    this.noAnswer = noAnswer; // the request may or may not have gone through
  }
}

async function apiOnce(method, pathname, params) {
  const body = new URLSearchParams({ ...params, access_token: config.igToken });
  const url = method === "GET" ? `${base()}/${pathname}?${body}` : `${base()}/${pathname}`;
  const res = await fetch(url, { method, body: method === "GET" ? undefined : body, signal: AbortSignal.timeout(60000) }).catch((e) => {
    throw new IgError(`Instagram ${pathname}: ${e.name === "TimeoutError" ? "timed out" : e.message}`, true, true);
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const err = data.error ?? {};
    // is_transient / 5xx / "media not ready yet" (9007) / rate limits (4, 17, 32, 613) are worth retrying
    const transient = err.is_transient === true || res.status >= 500 || [1, 2, 4, 17, 32, 613].includes(err.code) || err.error_subcode === 2207027 || err.code === 9007;
    throw new IgError(`Instagram ${pathname}: ${err.message ?? res.status} ${err.error_user_msg ?? ""}`.trim(), transient);
  }
  return data;
}

// Retries temporary failures with a growing wait; anything else (bad token, bad image) fails at once.
// With once=true a request that got no answer is never repeated (used for publishing, so a post
// that went through but timed out on the way back can't be published twice).
async function api(method, pathname, params = {}, tries = 4, once = false) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await apiOnce(method, pathname, params);
    } catch (e) {
      if (!e.transient || attempt >= tries || (once && e.noAnswer)) throw e;
      console.warn(`  ${e.message.slice(0, 120)} — retrying in ${attempt * 10}s`);
      await sleep(attempt * 10000);
    }
  }
}

async function waitReady(id, label) {
  for (let i = 0; i < 30; i++) {
    const { status_code, status } = await api("GET", id, { fields: "status_code,status" });
    if (status_code === "FINISHED") return;
    if (status_code === "ERROR" || status_code === "EXPIRED") throw new Error(`${label} failed: ${status}`);
    await sleep(4000);
  }
  throw new Error(`${label} not ready after 2 minutes`);
}

export async function publishCarousel(imageUrls, caption) {
  if (!config.igUserId || !config.igToken) throw new Error("IG_USER_ID / IG_ACCESS_TOKEN are not set");
  if (imageUrls.length < 2 || imageUrls.length > 10) throw new Error("A carousel needs 2–10 images");

  const children = [];
  for (const [i, url] of imageUrls.entries()) {
    const { id } = await api("POST", `${config.igUserId}/media`, { image_url: url, is_carousel_item: "true" });
    children.push(id);
    console.log(`  uploaded slide ${i + 1}/${imageUrls.length}`);
  }
  for (const [i, id] of children.entries()) await waitReady(id, `slide ${i + 1}`);

  const { id: carousel } = await api("POST", `${config.igUserId}/media`, {
    media_type: "CAROUSEL",
    children: children.join(","),
    caption,
  });
  await waitReady(carousel, "carousel");
  // publishing straight after FINISHED sometimes answers "media not ready"; api() retries that
  const { id: mediaId } = await api("POST", `${config.igUserId}/media_publish`, { creation_id: carousel }, 5, true);
  const { permalink } = await api("GET", mediaId, { fields: "permalink" }, 2).catch(() => ({}));
  return { mediaId, permalink };
}

// A single-image Story (1080×1920). Like the carousel, a publish that may have gone through is never repeated.
export async function publishStory(imageUrl) {
  const { id } = await api("POST", `${config.igUserId}/media`, { image_url: imageUrl, media_type: "STORIES" });
  await waitReady(id, "story");
  const { id: mediaId } = await api("POST", `${config.igUserId}/media_publish`, { creation_id: id }, 5, true);
  return mediaId;
}

// The connected account (used by the "Check connections" workflow).
export function whoAmI() {
  return api("GET", "me", { fields: "user_id,username" }, 2);
}

// Long-lived Instagram tokens last 60 days; refreshing (allowed once the token is 24 h old) gives a fresh 60 days.
export async function refreshToken() {
  if (!config.igToken) throw new Error("IG_ACCESS_TOKEN is not set");
  const url = `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(config.igToken)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error || !data.access_token) throw new Error(`Token refresh failed: ${data.error?.message ?? res.status}`);
  return data; // { access_token, token_type, expires_in }
}
