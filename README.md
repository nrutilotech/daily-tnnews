# DAILY TNNEWS: automatic Tamil Nadu news on Instagram

Every 12 hours (7 AM and 7 PM IST) the bot posts a 10-slide carousel and a Story with the top 10 Tamil Nadu news of the last 12 hours, and updates a "link in bio" news page with links to the full reports.

## How one edition is made

1. **Collect.** About 160 headlines from the last 12 hours come from 13 news feeds: The Hindu TN and Chennai, Times of India Chennai, and Google News searches for government, weather, sports, business, education, health, agriculture, plus a Tamil-language search.
2. **Choose (Gemini, free tier).** Gemini picks 12 stories, ranked with government announcements and policies first, then weather, sports and other sectors. Stories that repeat the last few editions are set aside, and the best 10 are kept. Each story gets a short headline, a 2–3 sentence summary in Gemini's own words, a key fact, and the source. The link always comes from the news feed itself, never from the AI.
3. **Read the full articles.** Google News links are resolved to the publisher's real article, and the article text is read: about 9 in 10 articles can be read in full. The text is only used inside the run and is never stored or published.
4. **Choose photos (Pixabay, free licence).** Photos from news sites are copyrighted and never reposted.
   - **Brief:** Gemini reads each full article and describes a generic scene that fits it, for example "stormy sea and dark clouds" for a cyclone warning. It also checks the slide summary and key fact against the article and corrects them if the article says otherwise.
   - **Search:** Pixabay is searched inside a matching category. Photos tagged as fashion, glamour, portraits or people (unless the story is about people, like a match) are dropped.
   - **Check:** Gemini looks at up to 4 candidate photos per story and picks one only if it is an honest illustration of the article. It rejects anything unrelated, misleading (such as a foreign landmark) or inappropriate. If none fits, the slide uses a designed colour background. A wrong photo is never used.
5. **Short links.** Each article gets a short, easy-to-type link like `v.gd/tnnzc3fh`, from v.gd, with is.gd and TinyURL as backups; all free with no account. The codes avoid look-alike characters. If every service fails, the slide shows the article's own address. Instagram never makes links in images or captions tappable, so these are for typing; the tappable links are on the news page in the bio.
6. **Draw.**
   - **Carousel (1080×1350):** the cover carries the top story; slides 2–10 carry one story each, with category, headline, key fact, summary, source, short link and photo credit.
   - **Story (1080×1920):** "Edition is live", the top story, the next headlines, and "See all 10 on our latest post".
7. **Post.**
   - **Carousel:** posted with a caption giving the summary of the last 12 hours, then each numbered headline with its short link on the line below, "Full stories: link in bio", sources and hashtags.
   - **Story:** posted next. If the Story fails, the carousel stays up.
   - **Threads:** the same edition goes to Threads (links are clickable there): the 10 slides with the summary, then one reply per story with a clickable link to the full report. This is on once the `THREADS_ACCESS_TOKEN` secret is set. If Threads fails, Instagram is unaffected.
   - **Safety:** an edition is never posted twice, a publish that may have gone through is never repeated, and a scheduled run skips if an edition went out in the last 6 hours (for example after a manual post).
8. **News page.** <https://nrutilotech.github.io/daily-tnnews> is rebuilt after every post. It shows each story with its summary and a **Read the full story** button linking to the original report, plus the previous week of editions.

Free tiers cover everything: Gemini (about 3 calls per edition), Pixabay, GitHub Actions and GitHub Pages.

## Settings

**Secrets** (GitHub → Settings → Secrets and variables → Actions):

| Secret | What it is |
|---|---|
| `GEMINI_API_KEY` | Google AI Studio key: <https://aistudio.google.com/apikey> |
| `PIXABAY_API_KEY` | Pixabay key, shown under *Parameters → key* at <https://pixabay.com/api/docs/> once logged in |
| `IG_USER_ID` | Instagram user ID (Meta app → Instagram → API setup with Instagram login) |
| `IG_ACCESS_TOKEN` | Instagram token (same page, *Generate token*). Renewed automatically. |
| `THREADS_ACCESS_TOKEN` | (optional) Threads token for the page's Threads account. Renewed automatically with the Instagram token. |
| `GH_PAT` | Fine-grained GitHub token for this repo with **Secrets: Read and write**. Lets the bot renew the Instagram token. Expires 24 Oct 2027, so make a new one before then. |

**Variables** (optional, same page → *Variables*):

| Variable | Example | What it does |
|---|---|---|
| `DRY_RUN` | `true` | Pause posting. Slides are still built and kept on the run page. |
| `POST_STORY` | `false` | Stop posting the Story |
| `NEWS_LANGUAGE` | `ta` | Tamil slides (default English) |
| `INSTAGRAM_HANDLE` | `@dailytnnews` | Handle shown on the slides and page |
| `GEMINI_WRITER_MODEL`, `GEMINI_BACKUP_MODELS` | `gemini-3.8-flash` | Which Gemini models to use, main first then backups |
| `GEMINI_RESEARCH_MODEL` | (a paid model) | Adds a Google Search research pass. Not free for new users, so off by default. |

## Workflows

| Workflow | When | What it does |
|---|---|---|
| **Post news** | 7 AM and 7 PM IST, or **Run workflow** (with *dry run* ticked it builds only) | Builds and posts the edition, hosts the slides on the `media` branch (latest post only), and saves `state/history.json` (avoids repeats) and `state/editions.json` (feeds the page) |
| **Publish news page** | After every successful *Post news*, or a change to the page code | Rebuilds and publishes the GitHub Pages site. Pages source must be **GitHub Actions**. |
| **Refresh Instagram token** | 1st and 15th of each month | Renews the 60-day Instagram and Threads tokens and saves them back as secrets |

If a run fails, GitHub emails you, and the next run 12 hours later tries again. The slides from every run are kept on its run page for 7 days.

## Good to know

- **Gemini's free models are often busy.** Each model gets one quick retry, then a backup model takes over, so an edition takes about 1–6 minutes.
- **Instagram doesn't let apps edit or delete a published post.** To fix a slide, use the Instagram app: post → ⋯ → Edit → remove the slide.
- **Stories posted through the API can't have link stickers.** That's why the caption and Story point to the link in bio.
- **The bio link** (`https://nrutilotech.github.io/daily-tnnews`) can only be added from the Instagram app: Edit profile → Links.
- **AI can make mistakes.** Every slide names its source, and the page links to the original report. Use `DRY_RUN=true` whenever you want to check editions by hand first.

## On your own computer
```bash
npm install
```
```bash
npm test
```
```bash
npm run sample
```
`npm test` runs 12 offline checks with simulated Gemini, Pixabay and Instagram (no keys needed). They also run before every post, so a broken change can never publish. `npm run sample` draws demo slides and a Story into `out/` (no keys needed). Open `out/preview.html` to see them. To build a real edition, copy `.env.example` to `.env`, add the keys, then run `npm run build`.

| To change | Edit |
|---|---|
| News sources | `FEEDS` in `src/config.js` |
| Editorial rules, tone, language | `systemPrompt()` in `src/curate.js` |
| How photos are chosen | `src/images.js` |
| Slide and Story design | `src/render.js` |
| Caption | `buildCaption()` in `src/main.js` |
| News page | `src/site.js` |
| Posting times | the `cron` lines in `.github/workflows/post-news.yml` (UTC; IST = UTC + 5:30) |
| Profile icon | `brand/make-profile.mjs` (Tamil Nadu outline from Natural Earth, public domain) |

Fonts: Noto Sans and Noto Sans Tamil (SIL Open Font License, see `fonts/OFL.txt`).
