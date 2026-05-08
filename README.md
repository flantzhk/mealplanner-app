# Meal Planner

A weekly meal planning app for a household of 4 in Hong Kong. Faith plans; helper cooks. Desktop planner + mobile daily view for the helper + a Cloudflare Worker holding all data.

## What's in here

- `index.html` — Faith's planner (desktop-first)
- `helper.html` — Helper's daily view (mobile-first, WhatsApp link)
- `shared.js` — Units, scaling, start-time maths, i18n, last-eaten, API client
- `recipes.seed.json` — 17 pre-loaded recipes, full EN + TL + IL translations
- `scripts/seed-kv.mjs` — One-shot loader that pushes the seed into KV
- `worker/` — Cloudflare Worker (`meal-planner-api`) + wrangler config

## Architecture

- **Frontend:** two single-file React apps on GitHub Pages (no build step — Babel standalone + Tailwind CDN)
- **Backend:** Cloudflare Worker `meal-planner-api` with a KV namespace `MEAL_DATA`
- **Auth:** Faith has one long shared `FAITH_TOKEN`; helper view is read-only and unauthenticated

**Isolation from ShadowSpeak:** different Worker name, different KV namespace, different secret. Nothing shared.

## First-time setup

### 1. Cloudflare Worker

```bash
cd worker
npx wrangler login                           # one time
npx wrangler kv namespace create MEAL_DATA   # copy the id into wrangler.toml
# Edit wrangler.toml: paste the id where it says REPLACE_WITH_KV_ID_AFTER_CREATING
npx wrangler secret put FAITH_TOKEN          # paste a long random string — save it somewhere
npx wrangler deploy                          # publishes to meal-planner-api.<account>.workers.dev
curl https://meal-planner-api.<account>.workers.dev/health
```

Generate a decent token:
```bash
openssl rand -base64 32
```

### 2. Seed recipes + starter week

```bash
cd ..                                        # back to meal-planner/
export MP_API_BASE="https://meal-planner-api.<account>.workers.dev"
export MP_FAITH_TOKEN="<the token you just set>"
node scripts/seed-kv.mjs
```

This pushes all 17 recipes AND creates a starter weekplan for the current Monday.

### 3. Update `shared.js` default Worker URL

In `shared.js` find this line and swap to your actual URL so the pages work without needing to set it in Settings first:

```js
"https://meal-planner-api.faithkayiwa.workers.dev"
```

### 4. GitHub Pages

```bash
# Inside meal-planner/
git init
gh repo create meal-planner --public --source=. --remote=origin
git add . && git commit -m "Initial meal planner"
git push -u origin main
gh api -X POST repos/:owner/meal-planner/pages -f source[branch]=main -f source[path]=/
```

Your URLs:
- Planner: `https://<you>.github.io/meal-planner/`
- Helper:  `https://<you>.github.io/meal-planner/helper.html`

### 5. Plug Faith's token into the planner

Open the planner, click ⚙︎, paste the Worker URL + Faith token, hit Test → Save. Reloads with token in localStorage. You only do this once per browser.

### 6. Send the helper link via WhatsApp

```
https://<you>.github.io/meal-planner/helper.html
```

She bookmarks it. Opens every morning.

## How it works day-to-day

### Faith plans a week
1. Open planner
2. Click any meal cell → pick from the library (library shows "Last eaten: X days ago" per recipe, greyed-out if used this week)
3. ⚠ badge = stove conflict; 🌙 = start previous day / defrost needed
4. Adjust serves, check shopping list
5. Click **Save Week** — writes to KV, auto-updates the eaten-log

### Helper opens the link
1. Sees today's 3 meals in her chosen language (EN/TL/IL)
2. Big start time per meal
3. Ingredients (already scaled to household size) + numbered steps + YouTube button
4. 👍 / 👎 / 💬 per meal → feeds into Faith's "This week's feedback" panel
5. "Prep for tomorrow" section flags anything she needs to take out of the freezer or start marinating tonight

### Adding a recipe
Two options:
- **Via Claude Code** — ask me to add a recipe, I'll fit the schema, write translations, PUT to `/recipes/<id>` with the token.
- **Via planner UI** — (future) right now new recipes go in by seeding — see `recipes.seed.json` for the shape.

## Things flagged as "needs verification"

- **YouTube URLs** — I seeded every recipe with a YouTube search URL, not a specific video. Open each recipe once, pick the video you actually want, and update via Claude Code.
- **Translations** — every recipe ships with `translations_verified: false`. The helper view shows a "Translation OK?" button next to the meal name — when your helper taps it (and has permission), it flips the flag. Until verified, English shows as a small italic line under the translated text so nothing is lost.
- **Hero images** — using `source.unsplash.com/?<tags>` which returns a matching Unsplash photo. Replace with real photos of your actual cooking once you have them.

## Data model

KV keys:

| Key | Value |
|---|---|
| `recipes` | array of recipe objects |
| `weekplan:current` | current week's plan |
| `weekplan:archive:YYYY-MM-DD` | archived week plans (auto-archived when you save a new `week_start`) |
| `eaten-log` | `{ recipe_id: ["YYYY-MM-DD", …] }` — drives "last eaten" |
| `feedback:YYYY-Www` | array of `{date, meal, recipe_id, rating, note}` |

Endpoints:

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | — | Health check |
| GET | `/recipes` | — | List recipes |
| PUT | `/recipes` | Bearer | Replace full library |
| PUT | `/recipes/:id` | Bearer | Upsert one recipe |
| DELETE | `/recipes/:id` | Bearer | Remove one recipe |
| GET | `/weekplan` | — | Current week |
| PUT | `/weekplan` | Bearer | Save current week (archives prior) |
| GET | `/eaten-log` | — | History |
| POST | `/eaten-log` | Bearer | Record one meal as eaten |
| POST | `/feedback` | — | Helper 👍/👎/note |
| GET | `/feedback?date=YYYY-MM-DD` | — | Feedback for the week containing this date |

## Out of scope (v1)

- Printable pack (phone-first; add later if helper asks)
- Cantonese as 4th language
- Automated WhatsApp sending
- Nutritional info
- Multi-household
- AI meal suggestions

## Troubleshooting

- **Planner says "Could not load"** → open Settings, check Worker URL and token. Hit Test. The Worker URL should end in `.workers.dev` with no trailing slash.
- **Helper sees stale meals** → she needs to hard-refresh (pull down / long-press reload). There's no cache-busting on `GET /weekplan` beyond Cloudflare defaults.
- **Stove-conflict flag seems wrong** → check `active_time_mins` on the conflicting recipe; that's the hands-on window. Adjust if wildly off.
- **`source.unsplash.com` image not showing** → Unsplash's source endpoint occasionally fails. The card gracefully hides the image. Replace `hero_image` with a specific URL (`https://images.unsplash.com/photo-…`) for reliability.
