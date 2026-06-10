# 🎲 what2play

**what2play** helps people find the perfect board game. They tell the site
their mood ("chill", "party time", "us vs the game"…), how many players they
have and how much time, and it recommends games from BoardGameGeek's top 500 —
with **Buy on Amazon** links that earn you affiliate commission.

➡️ Live site (once you enable GitHub Pages — see step 1 below):
`https://sameggermont.github.io/Test1/`

---

## How the project is organised

| File / folder | What it is |
|---|---|
| `docs/index.html` | The web page (structure & text) |
| `docs/styles.css` | How the page looks (colors, layout) |
| `docs/app.js` | The "brain" — filtering, mood matching, rendering game cards |
| `docs/config.js` | **The only file you must edit** — your Amazon affiliate ID goes here |
| `docs/data/games.json` | The game database (top 500 from BoardGameGeek) |
| `scripts/fetch_games.py` | Script that downloads fresh game data from BoardGameGeek |
| `.github/workflows/update-data.yml` | A robot that runs that script for you, automatically, every Monday |

The site is a *static* website: no servers to run or pay for. GitHub hosts it
for free via **GitHub Pages**.

## Step 1 — Put the site live (5 minutes, free)

1. On GitHub, open this repository and merge this branch into your main branch
   (or just use this branch directly in the next step).
2. Go to **Settings → Pages** (left sidebar).
3. Under **Build and deployment**:
   - Source: **Deploy from a branch**
   - Branch: your main branch (or this one), folder: **`/docs`**
4. Click **Save**. After a minute or two your site is live at
   `https://sameggermont.github.io/Test1/`.

## Step 2 — Start earning: get an Amazon affiliate ID

1. Sign up (free) at <https://affiliate-program.amazon.com>.
   You'll need to describe your site — link to the GitHub Pages URL above.
2. Amazon gives you a **tracking ID** that looks like `yourname-20`.
3. Edit `docs/config.js` (you can do this right in the GitHub website — open
   the file, click the ✏️ pencil icon, change `YOURTAG-20` to your ID, commit).
4. Done. Every "Buy on Amazon" click now carries your ID, and you earn a
   commission (~3% on toys/games) on anything the visitor buys.

> **Important:** Amazon requires an affiliate disclosure on the site (already
> included in the footer) and requires you to make ~3 sales in the first 180
> days to stay in the program. Other programs worth adding later:
> [Miniature Market](https://www.miniaturemarket.com/affiliate-program),
> impact.com retailers, or eBay Partner Network.

## Step 3 — Keep the game data fresh (automatic)

The **Actions** tab of this repository has a workflow called **"Update game
data"**. It runs automatically every Monday, and you can also run it by hand
(Actions tab → Update game data → Run workflow).

It deliberately does **not** use the BoardGameGeek API (which requires a
license for commercial use). Instead it combines public sources:

1. The latest top-500 **rankings** from a public community mirror
   ([beefsack/bgg-ranking-historicals](https://github.com/beefsack/bgg-ranking-historicals)).
2. A **detail snapshot** committed to this repo (`data/snapshot_details.json`):
   player counts, playtimes, complexity, categories, mechanics, descriptions
   and box-art links, originally from public community datasets.
3. The public **[Recommend.Games](https://recommend.games)** API (an
   independent project) for fresh complexity scores and high-resolution
   images — skipped gracefully if unreachable.

The result is committed to `docs/data/games.json` and GitHub Pages
republishes the site automatically.

### Price tiers

`docs/data/prices.json` maps every game to a typical-price bucket
(Under $25 / $25–60 / $60–100 / $100+). About 190 are based on known retail
prices of famous titles; the rest are estimated from the game's type. The
data robot never overwrites this file, so you can refine buckets by hand —
just edit the `tier` number (1–4) for a game. Later, once your Amazon
Associates account qualifies for the Product Advertising API, these can be
replaced with live prices.

## ⚠️ Things to know before this makes real money

- **BoardGameGeek's data terms.** The BGG XML API is free for *non-commercial*
  use. A hobby site with a few affiliate links is a common grey area, but if
  the site grows you should ask BGG for a commercial license — see
  <https://boardgamegeek.com/wiki/page/XML_API_Terms_of_Use>. They are
  generally friendly to fan projects that credit them (this site does, in the
  footer).
- **Traffic is the real product.** Affiliate sites earn roughly $10–30 per
  1,000 visitors in this niche. The site needs content that search engines can
  find — game guides, "best games for date night" lists, etc. — to attract
  visitors. That's the next phase.
- **A custom domain** (e.g. `what2play.com`, ~$12/year) makes the site look
  trustworthy and is required by some affiliate programs. GitHub Pages
  supports custom domains for free (Settings → Pages → Custom domain).

## Ideas for what to build next

- "Best with X players" sort and per-game detail pages (better for Google)
- Email capture ("game of the week" newsletter)
- Price comparison across multiple affiliate shops
- Blog section with buying guides (this is what actually ranks on Google)

---

*Game data and images courtesy of [BoardGameGeek](https://boardgamegeek.com).*
