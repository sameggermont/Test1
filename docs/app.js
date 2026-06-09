/* what2play — front-end logic
 *
 * Loads data/games.json (BGG top 500), filters it against the user's
 * mood / player count / time / complexity choices, and renders cards
 * with affiliate buy-links.
 */

(function () {
  "use strict";

  const PAGE_SIZE = 24;

  const state = {
    games: [],
    mood: "any",
    players: "any",
    time: "any",
    weight: "any",
    query: "",
    visible: PAGE_SIZE,
  };

  // ── Mood definitions ────────────────────────────────────────────────
  // Each mood is a predicate over a game's data. Games with missing data
  // for a field are not excluded by that field (we can't know).
  const MOODS = {
    any: () => true,
    chill: (g) =>
      okOrNull(g.weight, (w) => w <= 2.4) &&
      !hasAny(g.categories, ["Wargame"]),
    brainy: (g) => okOrNull(g.weight, (w) => w >= 3.0),
    party: (g) =>
      hasAny(g.categories, ["Party Game", "Humor", "Trivia", "Word Game"]) ||
      (okOrNull(g.maxPlayers, (n) => n >= 6) && okOrNull(g.weight, (w) => w <= 2.2) && g.maxPlayers !== null),
    coop: (g) => hasAny(g.mechanics, ["Cooperative Game"]),
    cutthroat: (g) =>
      !hasAny(g.mechanics, ["Cooperative Game"]) &&
      (hasAny(g.mechanics, [
        "Take That",
        "Area Majority / Influence",
        "Auction/Bidding",
        "Negotiation",
        "Trading",
        "Player Elimination",
        "Betting and Bluffing",
      ]) ||
        hasAny(g.categories, ["Negotiation", "Bluffing", "Wargame", "Fighting"])),
    quick: (g) => okOrNull(playMinutes(g), (t) => t !== null && t <= 30) && playMinutes(g) !== null,
    epic: (g) =>
      okOrNull(playMinutes(g), (t) => t !== null && t >= 120) ||
      hasAny(g.mechanics, ["Legacy Game", "Scenario / Mission / Campaign Game"]),
  };

  function hasAny(list, wanted) {
    return Array.isArray(list) && wanted.some((w) => list.includes(w));
  }

  // If the value is null/undefined (data not loaded yet), don't filter it out.
  function okOrNull(value, predicate) {
    return value === null || value === undefined ? true : predicate(value);
  }

  function playMinutes(g) {
    return g.playtime ?? g.maxPlaytime ?? g.minPlaytime ?? null;
  }

  // ── Filtering ───────────────────────────────────────────────────────
  function matches(g) {
    if (!MOODS[state.mood](g)) return false;

    if (state.players !== "any") {
      const n = Number(state.players);
      if (g.minPlayers !== null && n < g.minPlayers) return false;
      if (g.maxPlayers !== null && state.players !== "6" && n > g.maxPlayers) return false;
      if (state.players === "6" && g.maxPlayers !== null && g.maxPlayers < 6) return false;
    }

    if (state.time !== "any") {
      const t = playMinutes(g);
      const cap = Number(state.time);
      if (cap === 999) {
        if (t !== null && t < 90) return false; // "all night" → long games
      } else if (t !== null && t > cap) {
        return false;
      }
    }

    if (state.weight !== "any" && g.weight !== null) {
      if (state.weight === "light" && g.weight > 2.0) return false;
      if (state.weight === "medium" && (g.weight <= 2.0 || g.weight > 3.2)) return false;
      if (state.weight === "heavy" && g.weight <= 3.2) return false;
    }

    if (state.query) {
      const hay = [g.name, g.description, ...(g.categories || []), ...(g.mechanics || [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!state.query.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false;
    }

    return true;
  }

  // ── Rendering ───────────────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);

  function amazonUrl(g) {
    const cfg = window.W2P_CONFIG || {};
    const q = encodeURIComponent(`${g.name} board game`);
    const tag = encodeURIComponent(cfg.amazonTag || "");
    return `https://${cfg.amazonDomain || "www.amazon.com"}/s?k=${q}&tag=${tag}`;
  }

  function card(g, spotlight) {
    const img = g.image || g.thumbnail || "";
    const players =
      g.minPlayers !== null
        ? g.minPlayers === g.maxPlayers
          ? `${g.minPlayers}p`
          : `${g.minPlayers}–${g.maxPlayers}p`
        : null;
    const best = g.bestWith ? `best ${g.bestWith}p` : null;
    const time = playMinutes(g) !== null ? `${playMinutes(g)} min` : null;
    const weight = g.weight !== null ? `${g.weight}/5 weight` : null;

    const badges = [
      `<span class="badge rank">#${g.rank}</span>`,
      g.rating !== null ? `<span class="badge rating">★ ${g.rating.toFixed(1)}</span>` : "",
      players ? `<span class="badge">👥 ${players}</span>` : "",
      best ? `<span class="badge">👍 ${best}</span>` : "",
      time ? `<span class="badge">⏱ ${time}</span>` : "",
      weight ? `<span class="badge">🧠 ${weight}</span>` : "",
    ].join("");

    return `
      <article class="card${spotlight ? " spotlight" : ""}">
        ${img ? `<img class="card-img" loading="lazy" src="${img}" alt="${esc(g.name)} box art">` : `<div class="card-img"></div>`}
        <div class="card-body">
          <h3>${esc(g.name)} <span class="year">${g.year ?? ""}</span></h3>
          <div class="badges">${badges}</div>
          ${g.description ? `<p class="desc">${esc(g.description)}</p>` : ""}
          <div class="card-actions">
            <a class="btn buy" href="${amazonUrl(g)}" target="_blank" rel="noopener sponsored">Buy on Amazon</a>
            <a class="btn bgg" href="https://boardgamegeek.com/boardgame/${g.id}" target="_blank" rel="noopener">BGG</a>
          </div>
        </div>
      </article>`;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  let luckyPick = null;

  function render() {
    const results = state.games.filter(matches);
    const shown = results.slice(0, state.visible);

    $("#result-count").textContent = results.length
      ? `${results.length} game${results.length === 1 ? "" : "s"} match`
      : "";
    $("#results").innerHTML = shown.map((g) => card(g, luckyPick === g.id)).join("");
    $("#empty-state").hidden = results.length > 0;
    $("#show-more").hidden = results.length <= state.visible;

    if (luckyPick !== null) {
      const el = $(".card.spotlight");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      luckyPick = null;
    }
  }

  // ── Wiring ──────────────────────────────────────────────────────────
  function wireChips(containerId, attr, key) {
    const box = document.getElementById(containerId);
    box.addEventListener("click", (e) => {
      const btn = e.target.closest(".chip");
      if (!btn) return;
      box.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
      btn.classList.add("active");
      state[key] = btn.dataset[attr];
      state.visible = PAGE_SIZE;
      render();
    });
    box.querySelector(".chip").classList.add("active"); // default = first ("any")
  }

  function init() {
    wireChips("mood-chips", "mood", "mood");
    wireChips("player-chips", "players", "players");
    wireChips("time-chips", "time", "time");
    wireChips("weight-chips", "weight", "weight");

    $("#search-box").addEventListener("input", (e) => {
      state.query = e.target.value.trim();
      state.visible = PAGE_SIZE;
      render();
    });

    $("#show-more").addEventListener("click", () => {
      state.visible += PAGE_SIZE;
      render();
    });

    $("#lucky-btn").addEventListener("click", () => {
      const results = state.games.filter(matches);
      if (!results.length) return;
      // Weighted towards the higher-ranked matches so picks stay good.
      const pool = results.slice(0, Math.max(10, Math.floor(results.length / 4)));
      const pick = pool[Math.floor(Math.random() * pool.length)];
      luckyPick = pick.id;
      state.visible = Math.max(state.visible, results.indexOf(pick) + 1);
      render();
    });

    fetch("data/games.json")
      .then((r) => r.json())
      .then((data) => {
        state.games = data.games;
        render();
      })
      .catch(() => {
        $("#result-count").textContent = "Could not load game data.";
      });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
