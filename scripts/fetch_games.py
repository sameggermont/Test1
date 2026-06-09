#!/usr/bin/env python3
"""Fetch the BGG top-500 ranking list and enrich it with game details.

1. Downloads the most recent daily rankings CSV from the public mirror
   github.com/beefsack/bgg-ranking-historicals (BGG publishes these dumps).
2. Fetches details for the top 500 games from the official BGG XML API2
   (players, playtime, weight, categories, mechanics, images, ...).
3. Writes everything to docs/data/games.json, which the website reads.

Run with no arguments:  python3 scripts/fetch_games.py
"""

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
import xml.etree.ElementTree as ET
from pathlib import Path

TOP_N = 500
BATCH_SIZE = 20          # games per BGG API request
SLEEP_BETWEEN = 5        # seconds between API requests (be polite, avoid 429s)
USER_AGENT = "what2play data updater (https://github.com/sameggermont/Test1)"
RANKINGS_URL = "https://raw.githubusercontent.com/beefsack/bgg-ranking-historicals/master/{date}.csv"
API_URL = "https://boardgamegeek.com/xmlapi2/thing?id={ids}&stats=1"
OUTPUT = Path(__file__).resolve().parent.parent / "docs" / "data" / "games.json"


# Since October 2025 the BGG XML API requires a registered access token:
# https://boardgamegeek.com/using_the_xml_api
BGG_TOKEN = os.environ.get("BGG_API_TOKEN", "").strip()


def http_get(url, retries=5):
    headers = {"User-Agent": USER_AGENT}
    if BGG_TOKEN and "boardgamegeek.com" in url:
        headers["Authorization"] = f"Bearer {BGG_TOKEN}"
    for attempt in range(retries):
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                if resp.status == 202:  # BGG queued the request; try again
                    time.sleep(10)
                    continue
                return resp.read()
        except urllib.error.HTTPError as e:
            if e.code == 401:
                sys.exit(
                    "ERROR: BoardGameGeek rejected the request (401 Unauthorized).\n"
                    "The BGG XML API now requires a free access token.\n"
                    "1. Register at https://boardgamegeek.com/using_the_xml_api\n"
                    "2. Add the token as a repository secret named BGG_API_TOKEN\n"
                    "   (GitHub repo -> Settings -> Secrets and variables -> Actions)."
                )
            if e.code in (202, 429, 500, 502, 503) and attempt < retries - 1:
                wait = 15 * (attempt + 1)
                print(f"  HTTP {e.code}, retrying in {wait}s...")
                time.sleep(wait)
                continue
            raise
    raise RuntimeError(f"Gave up fetching {url}")


def latest_rankings():
    """Try today's date backwards until a non-empty rankings CSV is found."""
    day = dt.date.today()
    for _ in range(30):
        url = RANKINGS_URL.format(date=day.isoformat())
        try:
            body = http_get(url, retries=1).decode("utf-8")
            rows = [r for r in csv.DictReader(io.StringIO(body)) if r.get("Rank", "").isdigit()]
            if len(rows) > 1000:
                print(f"Using rankings from {day.isoformat()} ({len(rows)} ranked games)")
                rows.sort(key=lambda r: int(r["Rank"]))
                return rows[:TOP_N]
        except Exception:
            pass
        day -= dt.timedelta(days=1)
    raise RuntimeError("No usable rankings CSV found in the last 30 days")


def clean_description(raw, limit=500):
    if not raw:
        return None
    text = html.unescape(raw)
    text = re.sub(r"&#10;|\n", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > limit:
        text = text[: limit].rsplit(" ", 1)[0] + "…"
    return text or None


def best_player_count(item):
    """Read the 'suggested_numplayers' community poll and return the count
    with the most 'Best' votes, e.g. '4' or '2'."""
    poll = item.find("poll[@name='suggested_numplayers']")
    if poll is None:
        return None
    best, votes = None, -1
    for results in poll.findall("results"):
        n = results.get("numplayers", "")
        for res in results.findall("result"):
            if res.get("value") == "Best" and int(res.get("numvotes", 0)) > votes:
                votes = int(res.get("numvotes", 0))
                best = n
    return best


def parse_item(item):
    def attr(path, name="value", cast=None):
        el = item.find(path)
        if el is None:
            return None
        v = el.get(name)
        if v in (None, "", "0") and cast in (int, float) and path != "yearpublished":
            return None
        try:
            return cast(v) if cast else v
        except (TypeError, ValueError):
            return None

    def text(path):
        el = item.find(path)
        return el.text if el is not None and el.text else None

    stats = item.find("statistics/ratings")
    weight = rating = users = None
    if stats is not None:
        try:
            weight = round(float(stats.find("averageweight").get("value")), 2)
        except (TypeError, ValueError, AttributeError):
            pass
        try:
            rating = round(float(stats.find("average").get("value")), 2)
        except (TypeError, ValueError, AttributeError):
            pass
        try:
            users = int(stats.find("usersrated").get("value"))
        except (TypeError, ValueError, AttributeError):
            pass

    return {
        "id": int(item.get("id")),
        "name": attr("name[@type='primary']"),
        "year": attr("yearpublished", cast=int),
        "rank": None,  # filled in from the rankings CSV afterwards
        "rating": rating,
        "usersRated": users,
        "thumbnail": text("thumbnail"),
        "image": text("image"),
        "minPlayers": attr("minplayers", cast=int),
        "maxPlayers": attr("maxplayers", cast=int),
        "bestWith": best_player_count(item),
        "minPlaytime": attr("minplaytime", cast=int),
        "maxPlaytime": attr("maxplaytime", cast=int),
        "playtime": attr("playingtime", cast=int),
        "weight": weight,
        "minAge": attr("minage", cast=int),
        "categories": [l.get("value") for l in item.findall("link[@type='boardgamecategory']")],
        "mechanics": [l.get("value") for l in item.findall("link[@type='boardgamemechanic']")],
        "description": clean_description(text("description")),
    }


def main():
    ranked = latest_rankings()
    rank_by_id = {int(r["ID"]): int(r["Rank"]) for r in ranked}
    ids = [int(r["ID"]) for r in ranked]

    games = {}
    batches = [ids[i : i + BATCH_SIZE] for i in range(0, len(ids), BATCH_SIZE)]
    for n, batch in enumerate(batches, 1):
        print(f"Fetching details batch {n}/{len(batches)}...")
        xml_body = http_get(API_URL.format(ids=",".join(map(str, batch))))
        root = ET.fromstring(xml_body)
        for item in root.findall("item"):
            g = parse_item(item)
            g["rank"] = rank_by_id.get(g["id"])
            games[g["id"]] = g
        time.sleep(SLEEP_BETWEEN)

    ordered = sorted(games.values(), key=lambda g: g["rank"] or 99999)
    out = {
        "updated": dt.date.today().isoformat(),
        "source": "BoardGameGeek XML API2 + BGG daily rankings",
        "games": ordered,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Wrote {len(ordered)} games to {OUTPUT}")
    if len(ordered) < TOP_N * 0.9:
        print("WARNING: fewer games than expected", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
