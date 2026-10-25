// Short links for the slides (e.g. v.gd/tnnzc3fh), so readers can type a story's address easily.
// Free services with no account or key, tried in order; if all fail the slide shows the normal address.
// Codes are "tnn" + 5 lowercase letters/digits without look-alikes (no l/1/i, o/0), so they're easy to type.
const SAFE = "abcdefghjkmnpqrstuvwxyz23456789";
const code = () => "tnn" + Array.from({ length: 5 }, () => SAFE[Math.floor(Math.random() * SAFE.length)]).join("");

const SERVICES = [
  ["v.gd", (u, c) => `https://v.gd/create.php?format=simple&url=${encodeURIComponent(u)}${c ? `&shorturl=${c}` : ""}`],
  ["is.gd", (u, c) => `https://is.gd/create.php?format=simple&url=${encodeURIComponent(u)}${c ? `&shorturl=${c}` : ""}`],
  ["tinyurl.com", (u, c) => `https://tinyurl.com/api-create.php?url=${encodeURIComponent(u)}${c ? `&alias=${c}` : ""}`],
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Some services refuse cloud servers (GitHub's included); one that fails is skipped for the rest of the run.
async function shortenOne(url, dead) {
  if (!/^https?:\/\//.test(url ?? "")) return null;
  for (const [name, api] of SERVICES) {
    if (dead.has(name)) continue;
    // a readable custom code first (retried once if taken), then the service's own code
    for (const c of [code(), code(), null]) {
      try {
        const res = await fetch(api(url, c), { signal: AbortSignal.timeout(10000) });
        const text = (await res.text()).trim();
        if (res.ok && /^https:\/\/\S+$/.test(text) && text.length < 40) return text;
      } catch {
        break; // unreachable
      }
      await sleep(1100);
    }
    dead.add(name);
    console.warn(`  ${name} isn't shortening links right now; using the next service`);
  }
  return null;
}

// One at a time with a short pause: these free services ask for gentle use.
export async function shortenAll(urls) {
  const dead = new Set();
  const out = [];
  for (const u of urls) {
    out.push(await shortenOne(u, dead));
    await sleep(1100);
  }
  return out;
}
