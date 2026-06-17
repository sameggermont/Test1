#!/usr/bin/env python3
"""Build docs/data/games.json for what2play from public sources only
(no BoardGameGeek API, which needs a licence for commercial use).

It assembles two pools of games and merges them:

  * Top 2000 games  — from the public BGG rankings mirror
                      github.com/beefsack/bgg-ranking-historicals
  * ~250 children's games — the best-ranked titles in BGG's
                      "Children's Games" domain (so the Age filters
                      actually surface kid-suitable games, which sit
                      far down the overall ranking).

Details for every game are merged from public community datasets, all
fetched fresh at build time:

  * TidyTuesday 2022  — descriptions + canonical category/mechanic names
  * Kaggle 2021       — complexity (weight), BGG domains, owned counts
  * lunadu 2023       — box-art image URLs

Finally, if reachable (it is from GitHub Actions, not from every
sandbox), the public Recommend.Games API tops up high-resolution images
and any missing complexity for the newest games.

Run with no arguments:  python3 scripts/fetch_games.py
Set RG_ENRICH=0 to skip the Recommend.Games step.
"""

import ast
import csv
import datetime as dt
import html
import io
import json
import os
import re
import sys
import time
import urllib.request
from pathlib import Path

csv.field_size_limit(10_000_000)

TOP_N = 2000
KIDS_N = 250
NEW_N = 200          # recent releases (last 3 years) added beyond the top 2000
NEW_SINCE_YEARS = 3  # "last 3 years" window for new releases
KNOWN_DOMAINS = {
    "Strategy Games", "Family Games", "Party Games", "Thematic Games",
    "Abstract Games", "Wargames", "Children's Games", "Customizable Games",
}
USER_AGENT = "what2play data updater (https://github.com/sameggermont/Test1)"
ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "docs" / "data" / "games.json"
PRICES = ROOT / "docs" / "data" / "prices.json"

RANKINGS_URL = "https://raw.githubusercontent.com/beefsack/bgg-ranking-historicals/master/{date}.csv"
TT_URL = "https://raw.githubusercontent.com/rfordatascience/tidytuesday/master/data/2022/2022-01-25/details.csv"
KAGGLE_URL = "https://raw.githubusercontent.com/jalwz17/Board-Game-Data-Analysis/main/bgg_dataset.csv"
LUNADU_URL = "https://raw.githubusercontent.com/lunadu321/bgg_dataset/main/data/board_games_2023.csv"
RG_API_URL = "https://recommend.games/api/games/{id}/"


def http_get(url, timeout=90, retries=3):
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except Exception as e:
            if attempt == retries - 1:
                raise
            time.sleep(3 * (attempt + 1))


def read_csv(url, delimiter=","):
    body = http_get(url).decode("utf-8-sig")
    return list(csv.DictReader(io.StringIO(body), delimiter=delimiter))


def to_int(v):
    try:
        n = int(float(str(v).strip()))
        return n if n > 0 else None
    except (ValueError, TypeError):
        return None


def to_float(v):
    try:
        return float(str(v).replace(",", ".").strip())
    except (ValueError, TypeError):
        return None


def clean_desc(raw, limit=300):
    if not raw:
        return None
    text = html.unescape(raw)
    text = re.sub(r"&#10;|\n", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > limit:
        text = text[:limit].rsplit(" ", 1)[0] + "…"
    return text or None


def parse_list(raw):
    """TidyTuesday stores lists as a Python-literal string with canonical
    BGG names, e.g. "['Hand Management', 'Income']"."""
    if not raw:
        return []
    try:
        v = ast.literal_eval(raw)
        return [str(x) for x in v] if isinstance(v, list) else []
    except (ValueError, SyntaxError):
        return []


def split_domains(raw):
    return [d.strip() for d in (raw or "").split(",") if d.strip()]


def latest_rankings():
    day = dt.date.today()
    for _ in range(30):
        url = RANKINGS_URL.format(date=day.isoformat())
        try:
            rows = [r for r in csv.DictReader(io.StringIO(http_get(url, retries=1).decode("utf-8")))
                    if r.get("Rank", "").isdigit()]
            if len(rows) > 1000:
                rows.sort(key=lambda r: int(r["Rank"]))
                print(f"Rankings from {day.isoformat()} ({len(rows)} ranked games)")
                return rows
        except Exception:
            pass
        day -= dt.timedelta(days=1)
    raise RuntimeError("No usable rankings CSV in the last 30 days")


def index_by_id(rows, key):
    out = {}
    for r in rows:
        i = to_int(r.get(key))
        if i:
            out[i] = r
    return out


def build_game(gid, rank_row, tt, kg, lu, kids_flag):
    """Merge one game from the four community sources."""
    tt_r = tt.get(gid, {})
    kg_r = kg.get(gid, {})
    lu_r = lu.get(gid, {})

    name = (rank_row or {}).get("Name") or tt_r.get("primary") or lu_r.get("name") or kg_r.get("Name")
    year = to_int((rank_row or {}).get("Year")) or to_int(tt_r.get("yearpublished")) or to_int(lu_r.get("year_published"))

    # canonical category / mechanic names come from TidyTuesday
    categories = parse_list(tt_r.get("boardgamecategory"))
    mechanics = parse_list(tt_r.get("boardgamemechanic"))
    domains = split_domains(kg_r.get("Domains"))
    if kids_flag and "Children's Games" not in domains:
        domains.append("Children's Games")

    image = None
    img = (lu_r.get("image") or "").strip()
    if img.startswith("//"):
        img = "https:" + img
    if img.startswith("http"):
        image = img

    desc = clean_desc(tt_r.get("description")) or clean_desc(lu_r.get("description"))

    owned = max(filter(None, [to_int(tt_r.get("owned")), to_int(kg_r.get("Owned Users"))]), default=None)

    def pick_int(*vals):
        for v in vals:
            n = to_int(v)
            if n is not None:
                return n
        return None

    return {
        "id": gid,
        "name": name,
        "year": year,
        "rank": to_int((rank_row or {}).get("Rank")) or to_int(kg_r.get("BGG Rank")),
        "rating": to_float((rank_row or {}).get("Average")) or to_float(kg_r.get("Rating Average")) or to_float(tt_r.get("average")),
        "usersRated": pick_int((rank_row or {}).get("Users rated"), kg_r.get("Users Rated")),
        "thumbnail": (rank_row or {}).get("Thumbnail") or lu_r.get("thumbnail"),
        "image": image,
        "minPlayers": pick_int(tt_r.get("minplayers"), kg_r.get("Min Players"), lu_r.get("min_players")),
        "maxPlayers": pick_int(tt_r.get("maxplayers"), kg_r.get("Max Players"), lu_r.get("max_players")),
        "bestWith": None,
        "minPlaytime": pick_int(tt_r.get("minplaytime"), lu_r.get("min_playtime")),
        "maxPlaytime": pick_int(tt_r.get("maxplaytime"), lu_r.get("max_playtime")),
        "playtime": pick_int(tt_r.get("playingtime"), kg_r.get("Play Time"), lu_r.get("playing_time")),
        "weight": (lambda w: round(w, 2) if w else None)(to_float(kg_r.get("Complexity Average"))),
        "minAge": pick_int(tt_r.get("minage"), kg_r.get("Min Age"), lu_r.get("min_age")),
        "categories": categories,
        "mechanics": mechanics,
        "domains": domains,
        "description": desc,
        "owned": owned,
        "kids": kids_flag,
    }


def as_names(v):
    """Recommend.Games list fields may be plain strings or {name:...} dicts."""
    out = []
    if isinstance(v, list):
        for x in v:
            if isinstance(x, str):
                out.append(x)
            elif isinstance(x, dict):
                n = x.get("name") or x.get("value")
                if n:
                    out.append(str(n))
    elif isinstance(v, str):
        out.append(v)
    return out


def rg_enrich(game):
    """Fill gaps from the public Recommend.Games API (high-res image,
    complexity, players, and — crucially for brand-new releases not in the
    community datasets — categories/mechanics/domains/description).
    Community data already present is never overwritten. Returns True on a
    reachable response, False on failure."""
    try:
        raw = json.loads(http_get(RG_API_URL.format(id=game["id"]), timeout=15, retries=1))
    except Exception:
        return False
    imgs = raw.get("image_url")
    names = as_names(imgs)
    if names:
        game["image"] = names[0]
    if game["weight"] is None and isinstance(raw.get("complexity"), (int, float)) and raw["complexity"]:
        game["weight"] = round(float(raw["complexity"]), 2)
    if game["minPlayers"] is None and raw.get("min_players"):
        game["minPlayers"] = to_int(raw["min_players"])
    if game["maxPlayers"] is None and raw.get("max_players"):
        game["maxPlayers"] = to_int(raw["max_players"])
    if game["minAge"] is None and raw.get("min_age"):
        game["minAge"] = to_int(raw["min_age"])
    if game["playtime"] is None and raw.get("max_time"):
        game["playtime"] = to_int(raw.get("max_time"))
        game["minPlaytime"] = to_int(raw.get("min_time"))
        game["maxPlaytime"] = to_int(raw.get("max_time"))
    if not game["categories"]:
        game["categories"] = as_names(raw.get("category"))
    if not game["mechanics"]:
        game["mechanics"] = as_names(raw.get("mechanic"))
    if not game["domains"]:
        game["domains"] = [d for d in as_names(raw.get("game_type")) if d in KNOWN_DOMAINS]
    if not game["description"] and raw.get("description"):
        game["description"] = clean_desc(raw["description"])
    if raw.get("cooperative") and "Cooperative Game" not in game["mechanics"]:
        game["mechanics"].append("Cooperative Game")
    if game["rating"] is None and raw.get("avg_rating"):
        game["rating"] = round(float(raw["avg_rating"]), 2)
    return True


def heuristic_tier(g):
    """Typical-price bucket (1 cheapest .. 4 priciest) from game type."""
    t = g["playtime"] or g["maxPlaytime"] or 60
    w = g["weight"] or 2.5
    mech, cat, dom = g["mechanics"], g["categories"], g["domains"]
    campaign = any(m in mech for m in ("Legacy Game", "Scenario / Mission / Campaign Game", "Campaign / Battle Card Driven"))
    minis = "Miniatures" in cat
    if "Children's Games" in dom:
        return 1 if (g["playtime"] or 20) <= 30 else 2
    if (campaign and minis) or (minis and t >= 120):
        return 4
    if campaign or minis or w >= 3.6 or t >= 180:
        return 3
    if t <= 30 and w <= 1.8:
        return 1
    if "Card Game" in cat and t <= 45 and w <= 2.0:
        return 1
    return 2


def update_prices(games):
    """Extend prices.json with tiers for new games; never overwrite
    existing entries (the file is hand-editable)."""
    try:
        data = json.loads(PRICES.read_text(encoding="utf-8"))
    except Exception:
        data = {"tiers": {"1": "Under $25", "2": "$25–$60", "3": "$60–$100", "4": "$100+"}, "prices": {}}
    prices = data.setdefault("prices", {})
    added = 0
    for g in games:
        if str(g["id"]) not in prices:
            prices[str(g["id"])] = {"tier": heuristic_tier(g), "src": "est"}
            added += 1
    data["note"] = ("Typical price tiers. 1: under $25, 2: $25-60, 3: $60-100, 4: $100+. "
                    "src=known: real retail price; src=est: estimated from game type. "
                    "Hand-editable; the updater never overwrites existing entries.")
    PRICES.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Prices: {added} new tiers added, {len(prices)} total")


def main():
    print("Downloading sources...")
    rankings = latest_rankings()
    tt = index_by_id(read_csv(TT_URL), "id")
    kg = index_by_id(read_csv(KAGGLE_URL, ";"), "ID")
    lu = index_by_id(read_csv(LUNADU_URL), "game_id")
    print(f"  TidyTuesday {len(tt)}, Kaggle {len(kg)}, lunadu {len(lu)}")

    row_by_id = {to_int(r["ID"]): r for r in rankings[:TOP_N]}

    # children's games: best-ranked titles in the Children's Games domain
    def kg_rank(r):
        return to_int(r.get("BGG Rank")) or 10 ** 9
    kids_rows = sorted(
        (r for r in kg.values() if "Children's Games" in (r.get("Domains") or "")),
        key=kg_rank,
    )[:KIDS_N]
    kid_ids = {to_int(r["ID"]) for r in kids_rows if to_int(r["ID"])}

    # recent releases (last 3 years) that haven't yet climbed into the top
    # 2000, so the catalogue stays current. Best-ranked recent titles first.
    year_cut = dt.date.today().year - (NEW_SINCE_YEARS - 1)
    recent = [r for r in rankings
              if (to_int(r.get("Year")) or 0) >= year_cut
              and to_int(r["ID"]) not in row_by_id
              and to_int(r["ID"]) not in kid_ids]
    recent.sort(key=lambda r: int(r["Rank"]))
    recent_ids = set()
    for r in recent[:NEW_N]:
        row_by_id[to_int(r["ID"])] = r
        recent_ids.add(to_int(r["ID"]))

    all_ids = list(row_by_id.keys()) + [i for i in kid_ids if i not in row_by_id]
    games = [build_game(i, row_by_id.get(i), tt, kg, lu, i in kid_ids) for i in all_ids]
    games = [g for g in games if g["name"]]
    print(f"Assembled {len(games)} games "
          f"({len(kid_ids)} children's, {len(recent_ids)} recent releases)")

    if os.environ.get("RG_ENRICH", "1") != "0":
        probe = next((g for g in games if g["image"] is None), games[0])
        if rg_enrich(probe):
            print("Recommend.Games reachable — upgrading images / filling gaps...")
            todo = [g for g in games if g["image"] is None or g["weight"] is None or not g["mechanics"] or g is probe]
            ok = 0
            for g in todo:
                ok += rg_enrich(g)
                time.sleep(0.4)
            print(f"  enriched {ok}/{len(todo)} games via Recommend.Games")
        else:
            print("Recommend.Games not reachable — using community data only")

    games.sort(key=lambda g: (g["rank"] or 10 ** 9, not g["kids"]))
    out = {
        "updated": dt.date.today().isoformat(),
        "source": "BGG rankings mirror + TidyTuesday/Kaggle/lunadu community datasets + Recommend.Games",
        "count": len(games),
        "games": games,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Wrote {len(games)} games to {OUTPUT}")

    update_prices(games)


if __name__ == "__main__":
    main()
