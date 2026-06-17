/* what2play — front-end logic
 *
 * Loads data/games.json (BGG top 500) and data/prices.json, filters the
 * games against the visitor's chip selections, and renders cards with
 * geo-aware affiliate buy-links.
 *
 * Filter model: each row (Players, Age, Mechanics, …) is a dimension with
 * several toggle chips. Selecting chips in a row OR them together; the
 * different rows AND together. A row with nothing selected imposes no
 * filter. This matches the chip design (no explicit "Any" buttons).
 */

(function () {
  "use strict";

  const PAGE_SIZE = 24;
  const NEW_FROM = new Date().getFullYear() - 2; // "new additions" = last 3 years
  const TRIED_MIN_RATINGS = 3000;                // "tried & tested" = well-played

  // ── Small predicate helpers ─────────────────────────────────────────
  function hasAny(list, wanted) {
    return Array.isArray(list) && wanted.some((w) => list.includes(w));
  }
  function playMinutes(g) {
    return g.playtime ?? g.maxPlaytime ?? g.minPlaytime ?? null;
  }
  const cat = (g, ...names) => hasAny(g.categories, names);
  const mech = (g, ...names) => hasAny(g.mechanics, names);
  const dom = (g, ...names) => hasAny(g.domains, names);
  const kw = (g, ...words) => {
    const hay = `${g.description || ""} ${g.name} ${(g.categories || []).join(" ")}`.toLowerCase();
    return words.some((w) => hay.includes(w));
  };
  const isCoop = (g) => mech(g, "Cooperative Game");
  const isCampaign = (g) =>
    mech(g, "Legacy Game", "Scenario / Mission / Campaign Game", "Campaign / Battle Card Driven");
  const isPartyish = (g) =>
    dom(g, "Party Games") ||
    cat(g, "Party Game", "Humor", "Trivia", "Word Game") ||
    (g.maxPlayers !== null && g.maxPlayers >= 6 && g.weight !== null && g.weight <= 2.2);

  // ── Filter dimensions (mirrors the on-screen rows) ──────────────────
  // Each option's `test(g)` returns true when the game matches that chip.
  const FILTERS = [
    {
      key: "collection",
      label: "Show",
      options: [
        { id: "tried", label: "🏆 Tried & tested", test: (g) => g.usersRated !== null && g.usersRated >= TRIED_MIN_RATINGS },
        { id: "new", label: "✨ New additions", test: (g) => g.year !== null && g.year >= NEW_FROM },
      ],
    },
    {
      key: "players",
      label: "Players",
      options: [
        { id: "solo", label: "Solo", test: (g) => g.minPlayers !== null && g.minPlayers <= 1 },
        { id: "2", label: "2", test: (g) => g.minPlayers !== null && g.maxPlayers !== null && g.minPlayers <= 2 && g.maxPlayers >= 2 },
        { id: "3-4", label: "3–4", test: (g) => g.minPlayers !== null && g.maxPlayers !== null && g.maxPlayers >= 3 && g.minPlayers <= 4 },
        { id: "5+", label: "5+", test: (g) => g.maxPlayers !== null && g.maxPlayers >= 5 },
        { id: "7+", label: "7+", test: (g) => g.maxPlayers !== null && g.maxPlayers >= 7 },
      ],
    },
    {
      key: "age",
      label: "Age",
      options: [
        { id: "young", label: "Young kids 5–8", test: (g) => dom(g, "Children's Games") && g.minAge !== null && g.minAge <= 8 },
        { id: "older", label: "Older kids 9–12", test: (g) => g.minAge !== null && g.minAge >= 9 && g.minAge <= 12 && (dom(g, "Children's Games", "Family Games") || (g.weight !== null && g.weight <= 2.2)) },
        { id: "teens", label: "Teens", test: (g) => g.minAge !== null && g.minAge >= 13 && g.minAge <= 15 },
        { id: "mixed", label: "Mixed", test: (g) => dom(g, "Family Games") },
        { id: "adults", label: "Adults only", test: (g) => (g.minAge !== null && g.minAge >= 16) || cat(g, "Mature / Adult") },
      ],
    },
    {
      key: "mechanics",
      label: "Mechanics",
      options: [
        { id: "strategy", label: "Strategy", test: (g) => dom(g, "Strategy Games") },
        { id: "storytelling", label: "Storytelling", test: (g) => mech(g, "Storytelling", "Narrative Choice / Paragraph", "Role Playing") },
        { id: "dexterity", label: "Dexterity", test: (g) => cat(g, "Action / Dexterity") || mech(g, "Flicking") },
        { id: "social-deduction", label: "Social Deduction", test: (g) => mech(g, "Hidden Roles", "Voting", "Betting and Bluffing") || cat(g, "Deduction", "Bluffing") },
        { id: "cooperative", label: "Cooperative", test: isCoop },
        { id: "deck-building", label: "Deck-building", test: (g) => mech(g, "Deck, Bag, and Pool Building") },
        { id: "luck", label: "Luck", test: (g) => mech(g, "Dice Rolling", "Push Your Luck", "Re-rolling and Locking") },
        { id: "party", label: "Party", test: (g) => cat(g, "Party Game") || dom(g, "Party Games") },
        { id: "tile-laying", label: "Tile-laying", test: (g) => mech(g, "Tile Placement") },
        { id: "worker-placement", label: "Worker Placement", test: (g) => mech(g, "Worker Placement", "Worker Placement, Different Worker Types", "Worker Placement with Dice Workers") },
        { id: "roll-write", label: "Roll & Write", test: (g) => mech(g, "Paper-and-Pencil") },
        { id: "campaign", label: "Campaign", test: isCampaign },
      ],
    },
    {
      key: "time",
      label: "Play time",
      options: [
        { id: "quick", label: "Quick 15–30min", test: (g) => playMinutes(g) !== null && playMinutes(g) <= 30 },
        { id: "medium", label: "Medium 30–60min", test: (g) => playMinutes(g) !== null && playMinutes(g) > 30 && playMinutes(g) <= 60 },
        { id: "long", label: "Long 60–120min", test: (g) => playMinutes(g) !== null && playMinutes(g) > 60 && playMinutes(g) <= 120 },
        { id: "epic", label: "Epic 120+min", test: (g) => playMinutes(g) !== null && playMinutes(g) > 120 },
      ],
    },
    {
      key: "theme",
      label: "Theme",
      options: [
        { id: "fantasy", label: "Fantasy", test: (g) => cat(g, "Fantasy") },
        { id: "scifi", label: "Sci-Fi", test: (g) => cat(g, "Science Fiction") },
        { id: "modern", label: "Modern", test: (g) => cat(g, "Spies/Secret Agents", "Political", "Modern Warfare", "Travel") || kw(g, "modern", "contemporary") },
        { id: "abstract", label: "Abstract", test: (g) => dom(g, "Abstract Games") || cat(g, "Abstract Strategy") },
        { id: "historical", label: "Historical", test: (g) => cat(g, "Ancient", "Medieval", "Renaissance", "Post-Napoleonic", "Age of Reason", "American West", "World War II", "Civil War", "Prehistoric", "Napoleonic") },
        { id: "licensed", label: "Licensed IP", test: (g) => cat(g, "Movies / TV / Radio theme", "Video Game Theme", "Comic Book / Strip", "Novel-based") },
        { id: "horror", label: "Horror", test: (g) => cat(g, "Horror", "Zombies") },
        { id: "space", label: "Space", test: (g) => cat(g, "Space Exploration") },
        { id: "medieval", label: "Medieval", test: (g) => cat(g, "Medieval") },
        { id: "postapoc", label: "Post-Apocalyptic", test: (g) => kw(g, "apocalyp", "wasteland") },
        { id: "mystery", label: "Mystery", test: (g) => cat(g, "Murder/Mystery", "Deduction") || kw(g, "mystery", "murder", "detective", "crime") },
        { id: "western", label: "Western", test: (g) => cat(g, "American West") || kw(g, "wild west", "cowboy", "western") },
      ],
    },
    {
      key: "mood",
      label: "Mood",
      options: [
        { id: "casual", label: "Casual", test: (g) => g.weight !== null && g.weight <= 2.4 },
        { id: "competitive", label: "Competitive", test: (g) => !isCoop(g) && (mech(g, "Take That", "Area Majority / Influence", "Auction/Bidding", "Negotiation", "Player Elimination") || cat(g, "Fighting", "Wargame", "Negotiation")) },
        { id: "cooperative", label: "Cooperative", test: isCoop },
        { id: "party", label: "Party", test: isPartyish },
        { id: "brain-burner", label: "Brain-burner", test: (g) => g.weight !== null && g.weight >= 3.5 },
        { id: "thematic", label: "Thematic storytelling", test: (g) => dom(g, "Thematic Games") || mech(g, "Storytelling", "Narrative Choice / Paragraph") },
        { id: "relaxed", label: "Relaxed", test: (g) => g.weight !== null && g.weight <= 1.8 && !cat(g, "Wargame", "Fighting") },
        { id: "social", label: "Social", test: (g) => isPartyish(g) || mech(g, "Negotiation", "Trading", "Team-Based Game") || (g.maxPlayers !== null && g.maxPlayers >= 5) },
        { id: "strategic", label: "Strategic depth", test: (g) => g.weight !== null && g.weight >= 3.0 },
      ],
    },
    {
      key: "weight",
      label: "Complexity",
      options: [
        { id: "light", label: "Light", test: (g) => g.weight !== null && g.weight <= 2.0 },
        { id: "medium", label: "Medium", test: (g) => g.weight !== null && g.weight > 2.0 && g.weight <= 3.2 },
        { id: "heavy", label: "Heavy", test: (g) => g.weight !== null && g.weight > 3.2 },
      ],
    },
    {
      key: "price",
      label: "Typical price",
      options: [
        { id: "1", label: "Under $25", test: (g) => priceTier(g) === 1 },
        { id: "2", label: "$25–$60", test: (g) => priceTier(g) === 2 },
        { id: "3", label: "$60–$100", test: (g) => priceTier(g) === 3 },
        { id: "4", label: "$100+", test: (g) => priceTier(g) === 4 },
      ],
    },
  ];

  // ── State ───────────────────────────────────────────────────────────
  const state = {
    games: [],
    prices: {},
    query: "",
    country: "OTHER",
    visible: PAGE_SIZE,
    // one Set of selected option-ids per filter dimension
    active: Object.fromEntries(FILTERS.map((f) => [f.key, new Set()])),
  };

  function priceTier(g) {
    const p = state.prices[g.id];
    return p ? p.tier : null;
  }

  // Best-effort "may be hard to find at mainstream shops (Amazon/bol.com)".
  // We can't query retailer stock without their paid APIs, so this is a
  // popularity proxy: niche titles (few BGG owners, well down the ranking)
  // that aren't kids/family games — which ARE stocked widely despite low
  // BGG ownership.
  function isHardToFind(g) {
    return (
      g.owned !== null && g.owned !== undefined && g.owned < 1500 &&
      !dom(g, "Children's Games", "Family Games") &&
      (g.rank === null || g.rank > 800)
    );
  }

  // ── Filtering ───────────────────────────────────────────────────────
  function matches(g) {
    for (const f of FILTERS) {
      const sel = state.active[f.key];
      if (sel.size === 0) continue; // row not constraining
      const ok = f.options.some((o) => sel.has(o.id) && o.test(g));
      if (!ok) return false; // game matched none of this row's selected chips
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

  function anyActive() {
    return state.query !== "" || FILTERS.some((f) => state.active[f.key].size > 0);
  }

  // ── Country selector & affiliate links ─────────────────────────────
  const $ = (sel) => document.querySelector(sel);

  // The visitor picks their country at the top of the page. It decides
  // which Amazon store the buy link points to, and whether the bol.com
  // button (Netherlands & Belgium only) is shown.
  const COUNTRIES = {
    BE: { label: "🇧🇪 Belgium", amazon: "BE", bol: "be" },
    NL: { label: "🇳🇱 Netherlands", amazon: "NL", bol: "nl" },
    DE: { label: "🇩🇪 Germany", amazon: "DE", bol: null },
    OTHER: { label: "🌍 Other", amazon: "US", bol: null },
  };

  function detectCountry() {
    let region = null;
    for (const lang of navigator.languages || [navigator.language]) {
      const m = /-([a-z]{2})\b/i.exec(lang || "");
      if (m) { region = m[1].toUpperCase(); break; }
    }
    if (!region) {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
      region = { "Europe/Amsterdam": "NL", "Europe/Brussels": "BE", "Europe/Berlin": "DE", "Europe/Vienna": "DE" }[tz] || null;
    }
    return COUNTRIES[region] ? region : "OTHER";
  }

  // Resolved from the selected country on every change.
  let market = { domain: "www.amazon.com", tag: "" };
  let bolRegion = null; // "be" | "nl" when bol.com applies, else null

  function applyCountry(code) {
    const cfg = window.W2P_CONFIG || {};
    const c = COUNTRIES[code] || COUNTRIES.OTHER;
    const m = (cfg.amazonMarkets || {})[c.amazon] || { domain: "www.amazon.com", tag: "" };
    market = { domain: m.domain, tag: m.tag };
    bolRegion = c.bol;
    state.country = code;
    try { localStorage.setItem("w2p_country", code); } catch (e) { /* ignore */ }
  }

  function amazonUrl(g) {
    const q = encodeURIComponent(`${g.name} board game`);
    const tag = market.tag ? `&tag=${encodeURIComponent(market.tag)}` : "";
    return `https://${market.domain}/s?k=${q}${tag}`;
  }

  // bol.com ships only to the Netherlands & Belgium, so the button shows
  // only when one of those is selected.
  function bolUrl(g) {
    const cfg = window.W2P_CONFIG || {};
    const target = `https://www.bol.com/${bolRegion}/nl/s/?searchtext=${encodeURIComponent(g.name + " bordspel")}`;
    if (!cfg.bolSiteId) return target;
    return `https://partner.bol.com/click/click?p=1&t=url&s=${encodeURIComponent(cfg.bolSiteId)}&url=${encodeURIComponent(target)}&f=TXL`;
  }

  // ── Rendering ───────────────────────────────────────────────────────
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function card(g, spotlight) {
    const img = g.image || g.thumbnail || "";
    const fallback = g.image && g.thumbnail && g.image !== g.thumbnail
      ? ` onerror="this.onerror=null;this.src='${esc(g.thumbnail)}'"`
      : "";
    const players =
      g.minPlayers !== null
        ? g.minPlayers === g.maxPlayers ? `${g.minPlayers}p` : `${g.minPlayers}–${g.maxPlayers}p`
        : null;
    const best = g.bestWith ? `best ${g.bestWith}p` : null;
    const time = playMinutes(g) !== null ? `${playMinutes(g)} min` : null;
    const weight = g.weight !== null ? `${g.weight}/5 weight` : null;
    const tier = priceTier(g);
    const PRICE_LABELS = { 1: "under $25", 2: "$25–$60", 3: "$60–$100", 4: "$100+" };

    const badges = [
      `<span class="badge rank">#${g.rank}</span>`,
      g.rating !== null ? `<span class="badge rating">★ ${g.rating.toFixed(1)}</span>` : "",
      players ? `<span class="badge">👥 ${players}</span>` : "",
      best ? `<span class="badge">👍 ${best}</span>` : "",
      time ? `<span class="badge">⏱ ${time}</span>` : "",
      weight ? `<span class="badge">🧠 ${weight}</span>` : "",
      tier ? `<span class="badge price" title="typically ${PRICE_LABELS[tier]}">${"$".repeat(tier)}</span>` : "",
      isHardToFind(g) ? `<span class="badge niche" title="Niche title — mainstream shops like Amazon or bol.com may not stock it">⚠ Hard to find</span>` : "",
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
            ${bolRegion ? `<a class="btn bol" href="${bolUrl(g)}" target="_blank" rel="noopener sponsored">bol.com</a>` : ""}
            <a class="btn bgg" href="https://boardgamegeek.com/boardgame/${g.id}" target="_blank" rel="noopener">BGG</a>
          </div>
        </div>
      </article>`;
  }

  function renderFilterRows() {
    const html = FILTERS.map((f) => {
      const chips = f.options
        .map((o) => `<button class="chip" data-key="${f.key}" data-id="${o.id}">${esc(o.label)}</button>`)
        .join("");
      return `
        <div class="frow">
          <div class="frow-label">${esc(f.label)}</div>
          <div class="chips" data-row="${f.key}">${chips}</div>
        </div>`;
    }).join("");
    $("#filter-rows").innerHTML = html;
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
    $("#clear-btn").hidden = !anyActive();

    if (luckyPick !== null) {
      const el = $(".card.spotlight");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      luckyPick = null;
    }
  }

  // ── Wiring ──────────────────────────────────────────────────────────
  function init() {
    // Country: remembered choice, else a best guess, else "Other".
    let saved = null;
    try { saved = localStorage.getItem("w2p_country"); } catch (e) { /* ignore */ }
    const initialCountry = COUNTRIES[saved] ? saved : detectCountry();
    applyCountry(initialCountry);

    const countrySel = $("#country-select");
    if (countrySel) {
      countrySel.value = initialCountry;
      countrySel.addEventListener("change", (e) => {
        applyCountry(e.target.value);
        render(); // buy links and the bol.com button update immediately
      });
    }

    renderFilterRows();

    // One delegated listener handles every chip in every row.
    $("#filter-rows").addEventListener("click", (e) => {
      const btn = e.target.closest(".chip");
      if (!btn) return;
      const sel = state.active[btn.dataset.key];
      if (sel.has(btn.dataset.id)) sel.delete(btn.dataset.id);
      else sel.add(btn.dataset.id);
      btn.classList.toggle("active");
      state.visible = PAGE_SIZE;
      render();
    });

    $("#search-box").addEventListener("input", (e) => {
      state.query = e.target.value.trim();
      state.visible = PAGE_SIZE;
      render();
    });

    $("#clear-btn").addEventListener("click", () => {
      FILTERS.forEach((f) => state.active[f.key].clear());
      state.query = "";
      $("#search-box").value = "";
      document.querySelectorAll("#filter-rows .chip.active").forEach((c) => c.classList.remove("active"));
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
      // Bias towards higher-ranked matches so picks stay good.
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
