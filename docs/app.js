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
    prices: {},
    mood: "any",
    subMood: "all",
    players: "any",
    time: "any",
    weight: "any",
    price: "any",
    query: "",
    visible: PAGE_SIZE,
  };

  // ── Helpers ─────────────────────────────────────────────────────────
  function hasAny(list, wanted) {
    return Array.isArray(list) && wanted.some((w) => list.includes(w));
  }

  function playMinutes(g) {
    return g.playtime ?? g.maxPlaytime ?? g.minPlaytime ?? null;
  }

  const isCoop = (g) => hasAny(g.mechanics, ["Cooperative Game"]);
  const isCampaign = (g) =>
    hasAny(g.mechanics, ["Legacy Game", "Scenario / Mission / Campaign Game", "Campaign / Battle Card Driven"]);
  const isPartyish = (g) =>
    hasAny(g.domains, ["Party Games"]) ||
    hasAny(g.categories, ["Party Game", "Humor", "Trivia", "Word Game"]) ||
    (g.maxPlayers !== null && g.maxPlayers >= 6 && g.weight !== null && g.weight <= 2.2);

  // ── Mood definitions (two tiers) ────────────────────────────────────
  // Each mood has a predicate; optional `subs` refine it further.
  // Moods built on complexity (weight) require the value to be known so
  // "chill" and "deep strategy" never show the same unknown games.
  const MOODS = {
    any: { label: "Surprise me", test: () => true },
    chill: {
      label: "😌 Chill & easygoing",
      test: (g) => g.weight !== null && g.weight <= 2.4 && !hasAny(g.categories, ["Wargame"]),
      subs: {
        cozy: { label: "Super light & cozy", test: (g) => g.weight <= 1.8 },
        family: { label: "Family night", test: (g) => hasAny(g.domains, ["Family Games", "Children's Games"]) },
        calmcoop: { label: "Relaxed co-op", test: isCoop },
        solo: { label: "Playing solo", test: (g) => hasAny(g.mechanics, ["Solo / Solitaire Game"]) },
      },
    },
    brainy: {
      label: "🧠 Deep strategy",
      test: (g) => g.weight !== null && g.weight >= 3.0,
      subs: {
        heavy: { label: "Heavyweight euro", test: (g) => g.weight >= 3.5 && hasAny(g.domains, ["Strategy Games"]) },
        economic: { label: "Build an empire", test: (g) => hasAny(g.categories, ["Economic", "Industry / Manufacturing", "Civilization"]) },
        thematic: { label: "Rich theme", test: (g) => hasAny(g.domains, ["Thematic Games"]) },
        duel: { label: "1-on-1 brain duel", test: (g) => g.maxPlayers === 2 || g.bestWith === "2" },
      },
    },
    party: {
      label: "🎉 Party time",
      test: isPartyish,
      subs: {
        laughs: { label: "Big laughs", test: (g) => hasAny(g.categories, ["Humor"]) },
        bluff: { label: "Bluffing & deduction", test: (g) => hasAny(g.categories, ["Bluffing", "Deduction"]) },
        words: { label: "Words & trivia", test: (g) => hasAny(g.categories, ["Word Game", "Trivia"]) },
        crowd: { label: "Big group (8+)", test: (g) => g.maxPlayers !== null && g.maxPlayers >= 8 },
      },
    },
    coop: {
      label: "🤝 Us vs the game",
      test: isCoop,
      subs: {
        campaign: { label: "Ongoing campaign", test: isCampaign },
        light: { label: "Easy to learn", test: (g) => g.weight !== null && g.weight <= 2.3 },
        challenge: { label: "Brutal challenge", test: (g) => g.weight !== null && g.weight >= 2.8 },
        solo: { label: "Works solo too", test: (g) => hasAny(g.mechanics, ["Solo / Solitaire Game"]) },
      },
    },
    cutthroat: {
      label: "⚔️ Competitive & cutthroat",
      test: (g) =>
        !isCoop(g) &&
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
      subs: {
        duel: { label: "Head-to-head duel", test: (g) => g.maxPlayers === 2 },
        negotiate: { label: "Negotiate & betray", test: (g) => hasAny(g.categories, ["Negotiation"]) || hasAny(g.mechanics, ["Negotiation", "Trading"]) },
        war: { label: "Open warfare", test: (g) => hasAny(g.categories, ["Wargame", "Fighting"]) || hasAny(g.domains, ["Wargames"]) },
        territory: { label: "Fight for territory", test: (g) => hasAny(g.mechanics, ["Area Majority / Influence"]) },
      },
    },
    quick: {
      label: "⚡ Quick filler",
      test: (g) => playMinutes(g) !== null && playMinutes(g) <= 30,
      subs: {
        micro: { label: "15 min or less", test: (g) => playMinutes(g) <= 15 },
        social: { label: "Quick & social", test: isPartyish },
        thinky: { label: "Quick but thinky", test: (g) => g.weight !== null && g.weight >= 2.0 },
      },
    },
    epic: {
      label: "🐉 Epic adventure",
      test: (g) => (playMinutes(g) !== null && playMinutes(g) >= 120) || isCampaign(g),
      subs: {
        campaign: { label: "Campaign / legacy", test: isCampaign },
        fantasy: { label: "Fantasy worlds", test: (g) => hasAny(g.categories, ["Fantasy", "Adventure", "Mythology"]) },
        scifi: { label: "Sci-fi & space", test: (g) => hasAny(g.categories, ["Science Fiction", "Space Exploration"]) },
        allnight: { label: "All-night monster", test: (g) => playMinutes(g) !== null && playMinutes(g) >= 180 },
      },
    },
  };

  // ── Filtering ───────────────────────────────────────────────────────
  function matches(g) {
    const mood = MOODS[state.mood];
    if (!mood.test(g)) return false;
    if (state.subMood !== "all" && mood.subs && mood.subs[state.subMood] && !mood.subs[state.subMood].test(g)) {
      return false;
    }

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

    if (state.weight !== "any") {
      if (g.weight === null) return false; // complexity matters here: skip unknowns
      if (state.weight === "light" && g.weight > 2.0) return false;
      if (state.weight === "medium" && (g.weight <= 2.0 || g.weight > 3.2)) return false;
      if (state.weight === "heavy" && g.weight <= 3.2) return false;
    }

    if (state.price !== "any") {
      const p = state.prices[g.id];
      if (!p || String(p.tier) !== state.price) return false;
    }

    if (state.query) {
      const hay = [g.name, g.description, ...(g.categories || []), ...(g.mechanics || []), ...(g.domains || [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!state.query.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false;
    }

    return true;
  }

  // ── Rendering ───────────────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);

  // Figure out which country store fits the visitor: browser language
  // region first (e.g. "nl-BE" -> BE), timezone as a fallback.
  function detectMarket() {
    const cfg = window.W2P_CONFIG || {};
    const markets = cfg.amazonMarkets || {};
    const regionToMarket = {
      US: "US", CA: "US", GB: "UK", IE: "UK", DE: "DE", AT: "DE",
      FR: "FR", BE: "BE", NL: "NL",
    };
    let region = null;
    for (const lang of navigator.languages || [navigator.language]) {
      const m = /-([a-z]{2})\b/i.exec(lang || "");
      if (m) { region = m[1].toUpperCase(); break; }
    }
    if (!region) {
      const tz = (Intl.DateTimeFormat().resolvedOptions().timeZone || "");
      const tzMap = {
        "Europe/Amsterdam": "NL", "Europe/Brussels": "BE",
        "Europe/Berlin": "DE", "Europe/Vienna": "DE",
        "Europe/Paris": "FR", "Europe/London": "UK", "Europe/Dublin": "UK",
      };
      region = tzMap[tz] || (tz.startsWith("America/") ? "US" : null);
    }
    const key = regionToMarket[region] || cfg.amazonDefault || "US";
    const market = markets[key] || markets[cfg.amazonDefault] || { domain: "www.amazon.com", tag: "" };
    return { key, domain: market.domain, tag: market.tag };
  }

  let market = { key: "US", domain: "www.amazon.com", tag: "" };

  function amazonUrl(g) {
    const q = encodeURIComponent(`${g.name} board game`);
    const tag = market.tag ? `&tag=${encodeURIComponent(market.tag)}` : "";
    return `https://${market.domain}/s?k=${q}${tag}`;
  }

  function bolUrl(g) {
    const cfg = window.W2P_CONFIG || {};
    const country = market.key === "BE" ? "be" : "nl";
    const target = `https://www.bol.com/${country}/nl/s/?searchtext=${encodeURIComponent(g.name + " bordspel")}`;
    if (!cfg.bolSiteId) return target;
    return `https://partner.bol.com/click/click?p=1&t=url&s=${encodeURIComponent(cfg.bolSiteId)}&url=${encodeURIComponent(target)}&f=TXL`;
  }

  const showBol = () => market.key === "BE" || market.key === "NL";

  function card(g, spotlight) {
    const img = g.image || g.thumbnail || "";
    // If the big image fails to load, quietly fall back to the thumbnail.
    const fallback = g.image && g.thumbnail && g.image !== g.thumbnail
      ? ` onerror="this.onerror=null;this.src='${esc(g.thumbnail)}'"`
      : "";
    const players =
      g.minPlayers !== null
        ? g.minPlayers === g.maxPlayers
          ? `${g.minPlayers}p`
          : `${g.minPlayers}–${g.maxPlayers}p`
        : null;
    const best = g.bestWith ? `best ${g.bestWith}p` : null;
    const time = playMinutes(g) !== null ? `${playMinutes(g)} min` : null;
    const weight = g.weight !== null ? `${g.weight}/5 weight` : null;
    const price = state.prices[g.id];
    const PRICE_LABELS = { 1: "under $25", 2: "$25–$60", 3: "$60–$100", 4: "$100+" };

    const badges = [
      `<span class="badge rank">#${g.rank}</span>`,
      g.rating !== null ? `<span class="badge rating">★ ${g.rating.toFixed(1)}</span>` : "",
      players ? `<span class="badge">👥 ${players}</span>` : "",
      best ? `<span class="badge">👍 ${best}</span>` : "",
      time ? `<span class="badge">⏱ ${time}</span>` : "",
      weight ? `<span class="badge">🧠 ${weight}</span>` : "",
      price ? `<span class="badge price" title="typically ${PRICE_LABELS[price.tier]}">${"$".repeat(price.tier)}</span>` : "",
    ].join("");

    return `
      <article class="card${spotlight ? " spotlight" : ""}">
        ${img ? `<img class="card-img" loading="lazy" src="${esc(img)}" alt="${esc(g.name)} box art"${fallback}>` : `<div class="card-img"></div>`}
        <div class="card-body">
          <h3>${esc(g.name)} <span class="year">${g.year ?? ""}</span></h3>
          <div class="badges">${badges}</div>
          ${g.description ? `<p class="desc">${esc(g.description)}</p>` : ""}
          <div class="card-actions">
            <a class="btn buy" href="${amazonUrl(g)}" target="_blank" rel="noopener sponsored">Amazon</a>
            ${showBol() ? `<a class="btn bol" href="${bolUrl(g)}" target="_blank" rel="noopener sponsored">bol.com</a>` : ""}
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
  function chipButton(value, label, attr) {
    return `<button class="chip" data-${attr}="${value}">${label}</button>`;
  }

  function renderMoodChips() {
    $("#mood-chips").innerHTML = Object.entries(MOODS)
      .map(([key, m]) => chipButton(key, m.label, "mood"))
      .join("");
  }

  function renderSubMoodChips() {
    const box = $("#submood-chips");
    const mood = MOODS[state.mood];
    if (!mood.subs) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    box.hidden = false;
    box.innerHTML =
      chipButton("all", "All of it", "sub") +
      Object.entries(mood.subs)
        .map(([key, s]) => chipButton(key, s.label, "sub"))
        .join("");
    markActive(box, "sub", state.subMood);
  }

  function markActive(box, attr, value) {
    box.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c.dataset[attr] === value));
  }

  function wireChips(containerId, attr, key, onChange) {
    const box = document.getElementById(containerId);
    box.addEventListener("click", (e) => {
      const btn = e.target.closest(".chip");
      if (!btn || btn.dataset[attr] === undefined) return;
      state[key] = btn.dataset[attr];
      state.visible = PAGE_SIZE;
      markActive(box, attr, state[key]);
      if (onChange) onChange();
      render();
    });
  }

  function init() {
    market = detectMarket();
    renderMoodChips();
    markActive($("#mood-chips"), "mood", "any");

    wireChips("mood-chips", "mood", "mood", () => {
      state.subMood = "all";
      renderSubMoodChips();
    });
    wireChips("submood-chips", "sub", "subMood");
    wireChips("player-chips", "players", "players");
    wireChips("time-chips", "time", "time");
    wireChips("weight-chips", "weight", "weight");
    wireChips("price-chips", "price", "price");
    markActive($("#player-chips"), "players", "any");
    markActive($("#time-chips"), "time", "any");
    markActive($("#weight-chips"), "weight", "any");
    markActive($("#price-chips"), "price", "any");

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

    Promise.all([
      fetch("data/games.json").then((r) => r.json()),
      fetch("data/prices.json").then((r) => r.json()).catch(() => ({ prices: {} })),
    ])
      .then(([data, priceData]) => {
        state.games = data.games;
        state.prices = priceData.prices || {};
        render();
      })
      .catch(() => {
        $("#result-count").textContent = "Could not load game data.";
      });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
