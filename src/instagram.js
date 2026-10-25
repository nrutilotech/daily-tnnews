// Step 5: publish the slides as one Instagram carousel via the official Graph API.
// Instagram downloads each image from a public URL, so the slides must be hosted first.
import { config } from "./config.js";

const base = () => `https://${config.igHost}/${config.igApiVersion}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, pathname, params = {}) {
  const body = new URLSearchParams({ ...params, access_token: config.igToken });
  const url = method === "GET" ? `${base()}/${pathname}?${body}` : `${base()}/${pathname}`;
  const res = await fetch(url, { method, body: method === "GET" ? undefined : body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    throw new Error(`Instagram ${pathname}: ${data.error?.message ?? res.status} ${data.error?.error_user_msg ?? ""}`.trim());
  }
  return data;
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
  for (const id of children) await waitReady(id, "slide");

  const { id: carousel } = await api("POST", `${config.igUserId}/media`, {
    media_type: "CAROUSEL",
    children: children.join(","),
    caption,
  });
  await waitReady(carousel, "carousel");
  const { id: mediaId } = await api("POST", `${config.igUserId}/media_publish`, { creation_id: carousel });
  const { permalink } = await api("GET", mediaId, { fields: "permalink" }).catch(() => ({}));
  return { mediaId, permalink };
}

// Long-lived Instagram tokens last 60 days; refreshing gives a fresh 60 days.
export async function refreshToken() {
  const url = `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(config.igToken)}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(`Token refresh failed: ${data.error?.message ?? res.status}`);
  return data; // { access_token, token_type, expires_in }
}
