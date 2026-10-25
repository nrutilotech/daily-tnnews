# DAILY TNNEWS: automatic Tamil Nadu news carousel

Every 12 hours (7 AM and 7 PM IST) this bot:

1. **Collects** the last 12 hours of Tamil Nadu headlines from news feeds (The Hindu TN and Chennai, Times of India Chennai, and Google News searches for government, weather, sports, business, education, health, agriculture, plus a Tamil-language search).
2. **Asks Gemini** (Google's AI, free tier) to read the headlines and pick the **top 10**. Government announcements and policies come first, then weather, sports and other sectors. Gemini writes a short headline, a 2–3 sentence summary and a key fact for each story, in its own words, and names the source.
3. **Finds a photo** for each story on Pixabay. Pixabay photos are free to use, so no news-site photos are reposted.
4. **Draws 10 slides** (1080×1350):
   - **Slide 1 (the cover):** the DAILY TNNEWS logo, the edition and date, the main story's photo and headline, "Last 12 hours · Top 10" and "Swipe →".
   - **Slides 2–10:** one story each, with its number, category, headline, key fact, summary and source.
5. **Posts them as one Instagram carousel.** The caption gives the channel name, a summary of the last 12 hours, all 10 headlines as a numbered list, the sources and hashtags.

Instagram allows at most **10 slides** in a carousel. That's why the main story goes on the cover rather than on a slide of its own.

---

## What you need (one-time setup, about 1 hour)

### 1. The Instagram account
1. Create the Instagram account **DAILY TNNEWS** in the Instagram app (username `dailytnnews`).
2. Switch it to a **Professional account**: *Settings → Account type and tools → Switch to professional account → Business* (category: News & Media Website).

### 2. Instagram API access (free)
1. Go to <https://developers.facebook.com>, log in and click **Create App**. Choose the use case **"Manage messaging & content on Instagram"**, app type **Business**.
2. In the app, open **Instagram → API setup with Instagram login**.
3. Under *Generate access tokens*, click **Add account** and log in as the DAILY TNNEWS Instagram account.
4. Copy the **Instagram user ID** (a number) → this is `IG_USER_ID`.
5. Click **Generate token** and copy it → this is `IG_ACCESS_TOKEN` (valid for 60 days; the bot renews it automatically, see step 5).
6. Make sure the `instagram_business_basic` and `instagram_business_content_publish` permissions are listed.

Your own account can post without Meta's App Review, because you are the app's admin.

### 3. API keys
- **Gemini (free):** <https://aistudio.google.com/apikey> → sign in with Google → **Create API key** → `GEMINI_API_KEY`. The free tier covers this bot (2 posts a day). It works from the news-feed headlines; Google Search grounding is not free for new users, but you can set the `GEMINI_RESEARCH_MODEL` variable to a paid model to add it. Note: on the free tier Google may use requests to improve its products. That's fine here, because everything sent is public news.
- **Pixabay (free):** sign up at <https://pixabay.com>, then open <https://pixabay.com/api/docs/>. Your key is shown under *Parameters → key* → `PIXABAY_API_KEY`. (Pexels stopped issuing new keys in 2026; an existing Pexels key also works as `PEXELS_API_KEY`.)

### 4. Put the code on GitHub (free hosting and scheduler)
1. Create a free account at <https://github.com> and a **new public repository** called `daily-tnnews`. It must be public, because Instagram downloads the slide images from it. Your keys stay private as secrets.
2. Upload this folder. From a terminal in `D:\daily-tnnews`:
   ```bash
   git init -b main && git add . && git commit -m "DAILY TNNEWS bot"
   ```
   ```bash
   git remote add origin https://github.com/YOUR-USERNAME/daily-tnnews.git && git push -u origin main
   ```
3. In the repository, go to **Settings → Secrets and variables → Actions** and add these **Secrets**:

   | Secret | Value |
   |---|---|
   | `GEMINI_API_KEY` | Gemini key |
   | `PIXABAY_API_KEY` | Pixabay key |
   | `IG_USER_ID` | Instagram user ID |
   | `IG_ACCESS_TOKEN` | Instagram token |
   | `GH_PAT` | a GitHub token, so the bot can renew the Instagram token (step 5) |

   Optional **Variables** (same page, *Variables* tab):

   | Variable | Example | What it does |
   |---|---|---|
   | `NEWS_LANGUAGE` | `ta` | Tamil slides (default `en` = English) |
   | `INSTAGRAM_HANDLE` | `@dailytnnews` | Shown on the slides and in the caption |
   | `DRY_RUN` | `true` | Pause posting; slides are still built so you can check them |

### 5. Automatic token renewal
Create a GitHub token at <https://github.com/settings/personal-access-tokens>: choose *Fine-grained*, *Only this repository*, permission **Secrets: Read and write**. Save it as the `GH_PAT` secret. The *Refresh Instagram token* workflow then renews the Instagram token on the 1st and 15th of every month.

### 6. Test before going live
1. Open the **Actions** tab → **Post news** → **Run workflow**. Leave *dry run* ticked.
2. When the run finishes, download **slides** from the bottom of the run page. Open `preview.html` and check the slides and caption.
3. When you're happy, run it again with *dry run* unticked. The first real post goes up. After that it posts by itself at 7 AM and 7 PM every day.

---

## Testing on your own computer
```bash
npm install
```
```bash
npm run sample
```
`npm run sample` draws demo slides with placeholder text (no keys needed). Open `out/preview.html` to see them.

To build a real edition locally, copy `.env.example` to `.env`, fill in the keys, then:
```bash
npm run build
```

## Changing things
| What | Where |
|---|---|
| News sources | `FEEDS` in `src/config.js` |
| What the AI prioritises, tone, language | `systemPrompt()` in `src/curate.js` |
| Colours, fonts, layout | `src/render.js` |
| Caption format | `buildCaption()` in `src/main.js` |
| Posting times | the `cron` lines in `.github/workflows/post-news.yml` (UTC; IST = UTC + 5:30) |

## Good practice for a news page
- Read the first week of posts before trusting it fully. Gemini is told to use only facts it found in sources, but AI can still make mistakes. Use `DRY_RUN=true` any time you want to check posts by hand first.
- Every slide names its source, and the caption says the photos are illustrative.
- GitHub may start a scheduled run 5–20 minutes late at busy times. This is normal.
- Gemini's free models are often busy. The bot gives each model a quick retry, then moves on to the backups (`gemini-3.6-flash`, `gemini-3.5-flash-lite`; change them with the `GEMINI_BACKUP_MODELS` variable).
- The bot never posts the same edition twice. If a run is repeated, it skips the post. If Instagram times out while publishing, it stops rather than risking a double post, so check the page before re-running.
- If a run fails, GitHub emails you and the next run 12 hours later tries again. The slides are kept on the run page for 7 days, even for failed runs.

Fonts: Noto Sans and Noto Sans Tamil (SIL Open Font License, see `fonts/OFL.txt`).
