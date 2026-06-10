#!/usr/bin/env python3
"""Build docs/data/games.json — the what2play game database — WITHOUT
using the BoardGameGeek API (which requires a license for commercial use).

Sources, in order:
1. Latest BGG top-500 ranking list from the public community mirror
   github.com/beefsack/bgg-ranking-historicals (rank, rating, name, year).
2. Static detail snapshot committed to this repo (data/snapshot_details.json):
   players, playtime, weight, categories, mechanics, descriptions, images —
   originally from public community datasets.
3. Optionally, the public Recommend.Games API (an independent project,
   https://recommend.games) for fresh complexity scores and high-res images.
   If it is unreachable, the script simply keeps the snapshot values.

Run with no arguments:  python3 scripts/fetch_games.py
Set RG_ENRICH=0 to skip the Recommend.Games step entirely.
"""

import csv
import datetime as dt
import io
import json
import os
import time
import urllib.request
from pathlib import Path

TOP_N = 500
USER_AGENT = "what2play data updater (https://github.com/sameggermont/Test1)"
RANKINGS_URL = "https://raw.githubusercontent.com/beefsack/bgg-ranking-historicals/master/{date}.csv"
RG_API_URL = "https://recommend.games/api/games/{id}/"
ROOT = Path(__file__).resolve().parent.parent
SNAPSHOT = ROOT / "data" / "snapshot_details.json"
OUTPUT = ROOT / "docs" / "data" / "games.json"

DETAIL_FIELDS = (
    "minPlayers", "maxPlayers", "bestWith", "minPlaytime", "maxPlaytime",
    "playtime", "weight", "minAge", "categories", "mechanics", "domains",
    "description", "image",
)


def http_get(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def latest_rankings():
    """Try today's date backwards until a non-empty rankings CSV is found."""
    day = dt.date.today()
    for _ in range(30):
        url = RANKINGS_URL.format(date=day.isoformat())
        try:
            body = http_get(url).decode("utf-8")
            rows = [r for r in csv.DictReader(io.StringIO(body)) if r.get("Rank", "").isdigit()]
            if len(rows) > 1000:
                print(f"Using rankings from {day.isoformat()} ({len(rows)} ranked games)")
                rows.sort(key=lambda r: int(r["Rank"]))
                return rows[:TOP_N]
        except Exception:
            pass
        day -= dt.timedelta(days=1)
    raise RuntimeError("No usable rankings CSV found in the last 30 days")


def rg_enrich(game):
    """Fill complexity and a high-res image from the Recommend.Games API.
    Returns True on success, False on any failure (caller keeps snapshot data)."""
    try:
        raw = json.loads(http_get(RG_API_URL.format(id=game["id"]), timeout=15))
    except Exception:
        return False
    if game["weight"] is None and isinstance(raw.get("complexity"), (int, float)):
        game["weight"] = round(float(raw["complexity"]), 2)
    imgs = raw.get("image_url") or []
    if imgs and isinstance(imgs, list) and isinstance(imgs[0], str):
        game["image"] = imgs[0]
    if game["minPlayers"] is None and raw.get("min_players"):
        game["minPlayers"] = raw["min_players"]
    if game["maxPlayers"] is None and raw.get("max_players"):
        game["maxPlayers"] = raw["max_players"]
    if game["playtime"] is None and raw.get("max_time"):
        game["playtime"] = raw["max_time"]
        game["minPlaytime"] = raw.get("min_time")
        game["maxPlaytime"] = raw.get("max_time")
    if game["weight"] is None and not game["mechanics"] and raw.get("cooperative"):
        game["mechanics"] = ["Cooperative Game"]
    return True


def main():
    ranked = latest_rankings()
    snapshot = json.loads(SNAPSHOT.read_text(encoding="utf-8"))["details"]

    games = []
    for r in ranked:
        gid = int(r["ID"])
        g = {
            "id": gid,
            "name": r["Name"],
            "year": int(r["Year"]) if r["Year"].lstrip("-").isdigit() else None,
            "rank": int(r["Rank"]),
            "rating": float(r["Average"]),
            "usersRated": int(r["Users rated"]),
            "thumbnail": r["Thumbnail"],
        }
        details = snapshot.get(str(gid), {})
        for f in DETAIL_FIELDS:
            g[f] = details.get(f, [] if f in ("categories", "mechanics", "domains") else None)
        games.append(g)

    if os.environ.get("RG_ENRICH", "1") != "0":
        # Probe once; if the API is unreachable don't try 500 times.
        if rg_enrich(games[0]):
            print("Recommend.Games API reachable — enriching all games...")
            ok = 1
            for g in games[1:]:
                ok += rg_enrich(g)
                time.sleep(0.5)  # be polite
            print(f"Enriched {ok}/{len(games)} games")
        else:
            print("Recommend.Games API not reachable — keeping snapshot data")

    out = {
        "updated": dt.date.today().isoformat(),
        "source": "BGG community ranking mirror + public community datasets + Recommend.Games",
        "games": games,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Wrote {len(games)} games to {OUTPUT}")


if __name__ == "__main__":
    main()
