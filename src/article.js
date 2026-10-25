// Reads the full news report behind a story, so photos (and links) are based on the whole article,
// not just a headline. Google News links are first resolved to the publisher's real article URL.
const UA = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
  "Accept-Language": "en-IN,en;q=0.9",
};
const MAX_CHARS = 4000;

const decodeEntities = (s) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;|&lsquo;|&apos;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&[a-z]+;/gi, " ");
const clean = (s) => decodeEntities(String(s).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const JUNK = /subscribe|subscription|cookie|sign in|log in|newsletter|copyright|all rights reserved|download the app|follow us|advertisement/i;

// Google News RSS links point at news.google.com; ask Google for the real article URL.
async function resolveGoogleNews(link) {
  const id = new URL(link).pathname.split("/").pop();
  const page = await fetch(`https://news.google.com/rss/articles/${id}?oc=5`, { headers: UA, signal: AbortSignal.timeout(15000) }).then((r) => r.text());
  const sig = page.match(/data-n-a-sg="([^"]+)"/)?.[1];
  const ts = page.match(/data-n-a-ts="([^"]+)"/)?.[1];
  if (!sig || !ts) throw new Error("no signature on Google News page");
  const req = [[["Fbv4je", `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${id}",${ts},"${sig}"]`, null, "generic"]]];
  const res = await fetch("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
    method: "POST",
    headers: { ...UA, "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: "f.req=" + encodeURIComponent(JSON.stringify(req)),
    signal: AbortSignal.timeout(15000),
  }).then((r) => r.text());
  const url = JSON.parse(JSON.parse(res.split("\n\n")[1])[0][2])[1];
  if (!/^https?:\/\//.test(url)) throw new Error("could not decode Google News link");
  return url;
}

function extractText(html) {
  // 1) structured data: most news sites publish the whole story as articleBody
  const bodies = [];
  const walk = (o) => {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) return o.forEach(walk);
    if (typeof o.articleBody === "string") bodies.push(o.articleBody);
    Object.values(o).forEach(walk);
  };
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      walk(JSON.parse(m[1].trim()));
    } catch {}
  }
  const best = bodies.map(clean).sort((a, b) => b.length - a.length)[0];
  if (best && best.length > 300) return best;

  // 2) paragraphs, preferably inside the story container
  const noScripts = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>|<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, " ");
  const container =
    noScripts.match(/<(div|section)[^>]+(?:itemprop="articleBody"|class="[^"]*(?:articlebodycontent|article-body|article__body|story-content|story_content|articlebody|entry-content|post-content|content-body)[^"]*")[^>]*>[\s\S]*/i)?.[0] ??
    noScripts.match(/<article[\s\S]*?<\/article>/i)?.[0] ??
    noScripts;
  const paras = [...container.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => clean(m[1])).filter((p) => p.length > 60 && !JUNK.test(p));
  const text = [...new Set(paras)].join("\n");
  if (text.length > 300) return text;

  // 3) at least the page's own summary
  return clean(html.match(/<meta[^>]+(?:property="og:description"|name="description")[^>]+content="([^"]*)"/i)?.[1] ?? "");
}

// The report's own lead photo (og:image / twitter:image) as an absolute URL; site logos and
// placeholders are skipped.
const NOT_A_PHOTO = /logo|favicon|placeholder|sprite|spacer|blank|no[-_]?image|default[-_]?(?:image|img|thumb|og)/i;
export function extractImage(html, pageUrl) {
  const meta = (key) =>
    html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']+)["']`, "i"))?.[1] ??
    html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${key}["']`, "i"))?.[1];
  const raw = meta("og:image:secure_url") ?? meta("og:image") ?? meta("twitter:image") ?? meta("twitter:image:src");
  if (!raw) return null;
  try {
    const url = new URL(decodeEntities(raw).trim(), pageUrl).href;
    return /^https?:\/\//.test(url) && !NOT_A_PHOTO.test(url) ? url : null;
  } catch {
    return null;
  }
}

// Returns { url, text, image }: the publisher URL (when it could be resolved), up to MAX_CHARS of
// article text, and the report's lead photo (null if none).
export async function readArticle(link) {
  let url = link;
  try {
    if (/news\.google\.com/.test(link)) url = await resolveGoogleNews(link);
    const res = await fetch(url, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = (await res.text()).slice(0, 3_000_000);
    const finalUrl = res.url || url;
    // a Google News page (link not resolved) only has Google's own image
    const image = /news\.google\.com/.test(finalUrl) ? null : extractImage(html, finalUrl);
    return { url: finalUrl, text: extractText(html).slice(0, MAX_CHARS), image };
  } catch (e) {
    return { url, text: "", image: null, error: e.message };
  }
}

// Reads several articles at a time (politely: 4 in parallel).
export async function readArticles(links) {
  const out = new Array(links.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < links.length) {
        const i = next++;
        out[i] = links[i] ? await readArticle(links[i]) : { url: null, text: "", image: null };
      }
    }),
  );
  return out;
}
