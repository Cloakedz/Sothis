  /* ---------- Overwatch stats ---------- */
  const OWS = { tag: store.get("ow.tag") || "", platform: store.get("ow.platform") || "pc", mode: store.get("ow.mode") || "competitive" };
  let owCache = {};
  try { owCache = JSON.parse(store.get("ow.cache") || "{}") || {}; } catch {}
  let owBusy = false, owError = "", owErrorCode = 0, owEditing = false;
  const heroInfo = {};
  const HERO_NAMES = { dva: "D.Va", "soldier-76": "Soldier: 76", lucio: "Lúcio", torbjorn: "Torbjörn" };
  const cap = w => w ? w[0].toUpperCase() + w.slice(1) : "";
  const heroName = k => (heroInfo[k] && heroInfo[k].name) || HERO_NAMES[k] || String(k).split("-").map(cap).join(" ");
  const httpsUrl = u => typeof u === "string" && /^https:\/\//i.test(u) ? u : "";
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const n1 = v => v == null || isNaN(v) ? "—" : v >= 1000 ? (v / 1000).toFixed(1).replace(/\.0$/, "") + "k" : (Math.round(v * 10) / 10).toString();
  const playTime = sec => !sec ? "0 h" : sec >= 36000 ? Math.round(sec / 3600) + " h" : sec >= 3600 ? (sec / 3600).toFixed(1).replace(/\.0$/, "") + " h" : Math.round(sec / 60) + " min";
  const owKey = () => `${OWS.tag.toLowerCase()}|${OWS.platform}|${OWS.mode}`;
  const textOf = v => typeof v === "string" ? v : v && typeof v === "object" ? (v.en_us || Object.values(v)[0] || "") : "";

  async function loadOW(force) {
    if (!OWS.tag) { renderOW(); return; }
    const c = owCache[owKey()];
    if (!force && c && Date.now() - c.at < 10 * 60 * 1000) { renderOW(); return; }
    if (owBusy) return;
    owBusy = true; owError = ""; renderOW();
    if (!Object.keys(heroInfo).length) {
      D.owHeroes().then(list => { (list || []).forEach(h => { if (h && h.key) heroInfo[h.key] = h; }); renderOW(); }).catch(() => {});
    }
    let res;
    try { res = await D.owGet({ tag: OWS.tag, platform: OWS.platform, mode: OWS.mode }); } catch { res = {}; }
    owBusy = false;
    const sm = res.summary || {}, st = res.stats || {};
    owErrorCode = sm.status !== 200 ? sm.status : st.status;
    if (sm.status === 404) owError = "notfound";
    else if (sm.status === 429 || st.status === 429) owError = "busy";
    else if (sm.status !== 200 || !sm.json) owError = "down";
    else {
      owCache[owKey()] = { summary: sm.json, stats: st.status === 200 ? st.json : null, isPublic: res.isPublic, at: Date.now() };
      try { store.set("ow.cache", JSON.stringify(owCache)); } catch {}
    }
    renderOW();
  }

  function renderOW() {
    const setup = !OWS.tag || owEditing;
    $("owSetup").hidden = !setup;
    $("owView").hidden = setup;
    $("owCancel").hidden = !OWS.tag;
    if (setup) { $("owTag").value = OWS.tag; $("owPlat").value = OWS.platform; return; }

    const c = owCache[owKey()];
    const sm = c && c.summary, st = c && c.stats;
    const g = st && st.general;
    document.querySelectorAll("#owMode button").forEach(b => b.setAttribute("aria-checked", b.dataset.mode === OWS.mode));

    $("owName").textContent = (sm && sm.username) || OWS.tag.split("#")[0];
    const title = sm ? textOf(sm.title) : "";
    const endo = sm && sm.endorsement && sm.endorsement.level;
    $("owSub").textContent = [title, endo ? "Endorsement " + endo : "", OWS.platform === "console" ? "Console" : "PC"].filter(Boolean).join(" · ");
    const av = httpsUrl(sm && sm.avatar);
    if (av) $("owAv").src = av; else $("owAv").removeAttribute("src");
    $("owRefresh").disabled = owBusy;

    // message line
    let msg = "", bad = false;
    const isPrivate = (c && c.isPublic === false) || (sm && (sm.privacy === "private" || sm.is_private === true));
    if (owBusy && !c) msg = "Loading your stats…";
    else if (owError === "notfound") { msg = `Couldn't find ${OWS.tag} on ${OWS.platform === "console" ? "console" : "PC"}. Check the spelling, the number after #, and the platform.`; bad = true; }
    else if (owError === "busy") { msg = "The stats service is busy. Try again in a minute."; bad = true; }
    else if (owError === "down") { msg = `Couldn't get your stats (${owErrorCode ? "error " + owErrorCode : "no connection"}). Check your internet connection and try again in a minute.`; bad = true; }
    else if (isPrivate) { msg = "Your career profile is private. In Overwatch, go to Options → Social → Career Profile Visibility → Public. Blizzard can take a few minutes to update it."; bad = true; }
    else if (c && !g) { msg = `No ${OWS.mode === "competitive" ? "Competitive" : "Quick Play"} games show on your profile yet. If you've played, your career profile may be private.`; }
    if (c && bad && owError) msg += " Showing your saved stats.";
    $("owMsg").textContent = msg;
    $("owMsg").hidden = !msg;
    $("owMsg").classList.toggle("bad", bad);

    // ranks (competitive only)
    const ranks = $("owRanks");
    ranks.replaceChildren();
    const comp = sm && sm.competitive && sm.competitive[OWS.platform];
    const showRanks = OWS.mode === "competitive" && !!sm;
    $("owRankHead").hidden = ranks.hidden = !showRanks;
    if (showRanks) {
      $("owRankHead").textContent = comp && comp.season ? `Ranks · Season ${comp.season}` : "Ranks";
      [["tank", "Tank"], ["damage", "Damage"], ["support", "Support"]].forEach(([k, label]) => {
        const r = comp && comp[k];
        const box = mk("div", "rank" + (r ? "" : " none"));
        const icon = httpsUrl(r && r.rank_icon);
        if (icon) { const im = mk("img"); im.src = icon; im.alt = ""; box.append(im); } else box.append(mk("div", "ph"));
        box.append(mk("div", "role", label));
        box.append(mk("div", "tier", r ? `${cap(r.division)} ${r.tier}` : "Unranked"));
        ranks.append(box);
      });
    }
    try {   // best role rank for your Discord status
      const ORDER = ["bronze", "silver", "gold", "platinum", "emerald", "diamond", "master", "grandmaster", "champion", "ultimate"];
      const best = comp ? [["tank", "Tank"], ["damage", "Damage"], ["support", "Support"]].filter(([k]) => comp[k]).map(([k, l]) => ({ l, r: comp[k], v: ORDER.indexOf(String(comp[k].division).toLowerCase()) * 10 + (6 - (comp[k].tier || 5)) })).sort((a, b) => b.v - a.v)[0] : null;
      if (best && c && !owEditing) {
        window.__owRank = `${cap(best.r.division)} ${best.r.tier} ${best.l}`;
        // every role's rank too, so your status can show the rank for the role you're playing
        const roles = {}; [["tank", "Tank"], ["damage", "Damage"], ["support", "Support"]].forEach(([k, l]) => { if (comp[k]) roles[l] = `${cap(comp[k].division)} ${comp[k].tier}`; });
        D.gameRanks({ ow: window.__owRank, owRoles: roles });
      }
    } catch {}

    // overview tiles
    const tiles = $("owStats");
    tiles.replaceChildren();
    $("owStatHead").hidden = tiles.hidden = !g;
    if (g) {
      const a = g.average || {};
      const tile = (k, v, sub, wide) => {
        const t = mk("div", "tile" + (wide ? " wide" : ""));
        t.append(mk("div", "k", k), mk("div", "v", v));
        if (sub) t.append(mk("div", "s", sub));
        return t;
      };
      const wr = typeof g.winrate === "number" ? g.winrate : (g.games_played ? (g.games_won / g.games_played) * 100 : null);
      const wt = tile("Win rate", wr == null ? "—" : (Math.round(wr * 10) / 10) + "%", `${g.games_won ?? 0} W · ${g.games_lost ?? 0} L`, true);
      const bar = mk("div", "wbar"); const fill = mk("i", wr != null && wr < 50 ? "low" : ""); fill.style.width = Math.max(0, Math.min(100, wr || 0)) + "%"; bar.append(fill); wt.append(bar);
      tiles.append(wt,
        tile("Games", String(g.games_played ?? 0)),
        tile("Time played", playTime(g.time_played)),
        tile("KDA", g.kda == null ? "—" : String(Math.round(g.kda * 100) / 100)),
        tile("Elims", n1(a.eliminations), "per 10 min"),
        tile("Deaths", n1(a.deaths), "per 10 min"),
        tile("Damage", n1(a.damage), "per 10 min"),
        tile("Healing", n1(a.healing), "per 10 min"));
    }

    // top heroes by time played
    const list = $("owHeroes");
    list.replaceChildren();
    const hs = st && st.heroes ? Object.entries(st.heroes).filter(([, h]) => h && h.time_played).sort((x, y) => y[1].time_played - x[1].time_played).slice(0, 5) : [];
    $("owHeroHead").hidden = list.hidden = !hs.length;
    hs.forEach(([key, h]) => {
      const row = mk("div", "hero");
      const pic = httpsUrl(heroInfo[key] && heroInfo[key].portrait);
      if (pic) { const im = mk("img"); im.src = pic; im.alt = ""; row.append(im); } else row.append(mk("div", "hph"));
      const mid = mk("div");
      mid.append(mk("div", "hn", heroName(key)), mk("div", "hs", `${playTime(h.time_played)} · ${h.games_played ?? 0} games · KDA ${h.kda == null ? "—" : Math.round(h.kda * 100) / 100}`));
      const wr = typeof h.winrate === "number" ? h.winrate : (h.games_played ? (h.games_won / h.games_played) * 100 : null);
      const right = mk("div", "hw", wr == null ? "—" : Math.round(wr) + "% WR");
      const bar = mk("div", "wbar"); const fill = mk("i", wr != null && wr < 50 ? "low" : ""); fill.style.width = Math.max(0, Math.min(100, wr || 0)) + "%"; bar.append(fill); right.append(bar);
      row.append(mid, right);
      list.append(row);
    });

    $("owFoot").textContent = owBusy ? "Updating…" : c ? `Updated ${ago(c.at)} · from your public Overwatch career profile` : "";
    try { if (typeof game !== "undefined" && tab === "stats") renderAcct(); } catch {}
  }

  document.querySelectorAll("#owMode button").forEach(b => b.addEventListener("click", () => {
    if (OWS.mode === b.dataset.mode) return;
    OWS.mode = b.dataset.mode; store.set("ow.mode", OWS.mode); owError = ""; loadOW(false); renderOW();
  }));
  $("owRefresh").onclick = () => loadOW(true);
  $("owChange").onclick = () => { owEditing = true; renderOW(); $("owTag").focus(); };
  $("owCancel").onclick = () => { owEditing = false; renderOW(); };
  function useOWTag(tag) {
    OWS.tag = tag; OWS.platform = $("owPlat").value === "console" ? "console" : "pc";
    store.set("ow.tag", OWS.tag); store.set("ow.platform", OWS.platform);
    owEditing = false; owError = "";
    $("owResults").hidden = true; $("owFormErr").hidden = true;
    loadOW(true);
  }
  const owErr = t => { $("owFormErr").textContent = t; $("owFormErr").hidden = !t; };
  $("owForm").addEventListener("submit", async e => {
    e.preventDefault();
    const v = $("owTag").value.trim().replace(/\s*#\s*/, "#");
    $("owResults").hidden = true;
    if (/^[^#\s]{2,16}#\d{3,8}$/.test(v)) { useOWTag(v); return; }
    if (!/^[^#\s]{2,16}$/.test(v)) { owErr("Type your BattleTag like Name#1234, or just your name."); return; }
    // Name only: search and let them pick
    owErr("Searching…");
    let r;
    try { r = await D.owSearch({ name: v }); } catch { r = { status: 0, results: [] }; }
    if (!r.results.length) {
      owErr(r.status && r.status !== 200 && r.status !== 404
        ? `Search isn't working right now (error ${r.status}). Type your full BattleTag, like ${v}#1234.`
        : `No players named ${v} were found. Add the number from your BattleTag, like ${v}#1234.`);
      return;
    }
    owErr("");
    const list = $("owResults"); list.replaceChildren();
    r.results.forEach(p => {
      const row = mk("button", "hero"); row.type = "button";
      row.style.width = "100%"; row.style.textAlign = "left";
      const pic = httpsUrl(p.avatar);
      if (pic) { const im = mk("img"); im.src = pic; im.alt = ""; row.append(im); } else row.append(mk("div", "hph"));
      const mid = mk("div");
      mid.append(mk("div", "hn", String(p.id || "").replace("-", "#")), mk("div", "hs", [p.title, p.isPublic === false ? "Private profile" : "Public profile"].filter(Boolean).join(" · ")));
      row.append(mid, mk("div", "hw", "Pick"));
      row.addEventListener("click", () => useOWTag(String(p.id).replace("-", "#")));
      list.append(row);
    });
    list.hidden = false;
  });
  setInterval(() => { if (tab === "stats" && game === "ow") loadOW(false); else renderOW(); }, 60000);
  // keep your Overwatch rank (for your Discord status) fresh even when the Stats page isn't open
  setInterval(() => { if (!(tab === "stats" && game === "ow")) loadOW(false).catch(() => {}); }, 10 * 60 * 1000);
  D.onOwRefresh && D.onOwRefresh(() => loadOW(true).catch(() => {}));
  // Sothis asks for fresh ranks while you play and right after a match (for your Discord status)
  D.onStatsRefresh && D.onStatsRefresh(g => {
    try { if (g === "ow") loadOW(true).catch(() => {}); else if (g === "cs") loadCS(true).catch(() => {}); else if (g === "r6") loadR6(true).catch(() => {}); } catch {}
  });


  /* ---------- Stats: game switcher ---------- */
  const GAMES = ["ow", "cs", "r6", "fr"];
  var game = GAMES.includes(store.get("st.game")) ? store.get("st.game") : "ow";
  function showGame(g) {
    game = GAMES.includes(g) ? g : "ow";
    store.set("st.game", game);
    document.querySelectorAll("#gameSeg button").forEach(b => b.setAttribute("aria-checked", b.dataset.game === game));
    $("owBox").hidden = game !== "ow";
    $("csBox").hidden = game !== "cs";
    $("r6Box").hidden = game !== "r6";
    $("frTab").hidden = game !== "fr";
    $("acctSeg").hidden = game === "fr";
    if (game === "fr") { frShow(); return; }
    try { renderAcct(); } catch {}
    if (game === "ow") loadOW(false);
    else if (game === "cs") loadCS(false);
    else loadR6(false);
  }
  document.querySelectorAll("#gameSeg button").forEach(b => b.addEventListener("click", () => showGame(b.dataset.game)));

  /* ---------- CS2 (Leetify) ---------- */
  const CS = { steam: store.get("cs.steam") || "" };
  let csCache = null;
  try { csCache = JSON.parse(store.get("cs.cache") || "null"); } catch {}
  let csBusy = false, csError = "", csEditing = false;
  const pct = v => v == null || isNaN(v) ? null : (Math.abs(v) <= 1 ? v * 100 : v);
  const signed = v => v == null || isNaN(v) ? "—" : (v > 0 ? "+" : "") + (Math.round(v * 100) / 100).toFixed(2);
  const lrating = v => v == null || isNaN(v) ? null : (Math.abs(v) < 0.5 ? v * 100 : v);
  const PREMIER_TIERS = [[5000, "#8a93a6"], [10000, "#5f9bd1"], [15000, "#3b63d6"], [20000, "#7d48d8"], [25000, "#c447c4"], [30000, "#d9434b"], [Infinity, "#d6a12c"]];
  const mapName = m => String(m || "").replace(/^(de|cs|ar)_/, "").split("_").map(cap).join(" ") || "Unknown map";

  async function loadCS(force) {
    if (!CS.steam) { renderCS(); return; }
    const fresh = csCache && csCache.input === CS.steam && Date.now() - csCache.at < 10 * 60 * 1000;
    if (!force && fresh) { renderCS(); return; }
    if (csBusy) return;
    csBusy = true; csError = ""; renderCS();
    let r;
    try { r = await D.csGet({ steam: CS.steam }); } catch { r = { error: "down" }; }
    csBusy = false;
    const base = r && !r.error ? { input: CS.steam, name: r.name, avatar: r.avatar, steam64: r.steam64, at: Date.now() } : null;
    if (!r || r.error) csError = r && r.error === "badinput" ? "badinput" : r && r.error === "down" ? "down" : "notfound";
    else if (r.leetify.status === 404) { csError = "noleetify"; csCache = Object.assign(base, { profile: null }); }
    else if (r.leetify.status === 429) csError = "busy";
    else if (r.leetify.status !== 200 || !r.leetify.json) csError = "down";
    else csCache = Object.assign(base, { profile: r.leetify.json });
    store.set("cs.cache", JSON.stringify(csCache));
    renderCS();
  }

  function renderCS() {
    const setup = !CS.steam || csEditing;
    $("csSetup").hidden = !setup;
    $("csView").hidden = setup;
    $("csCancel").hidden = !CS.steam;
    if (setup) { $("csSteam").value = CS.steam; return; }

    const c = csCache && csCache.input === CS.steam ? csCache : null;
    const p = c && c.profile;
    $("csName").textContent = (c && c.name) || (p && p.name) || "Steam player";
    $("csSub").textContent = p ? `${p.total_matches ?? 0} matches tracked` : "Steam";
    const av = httpsUrl(c && c.avatar);
    if (av) $("csAv").src = av; else $("csAv").removeAttribute("src");
    $("csRefresh").disabled = csBusy;

    let msg = "", bad = false;
    if (csBusy && !c) msg = "Loading your stats…";
    else if (csError === "badinput") { msg = "That doesn't look like a Steam profile link. Copy it from your Steam profile page."; bad = true; }
    else if (csError === "notfound") { msg = "Couldn't find that Steam profile. Paste the full link from your Steam profile page."; bad = true; }
    else if (csError === "noleetify") { msg = "Leetify has no stats for this account yet. Sign in once at leetify.com with Steam, play a match, then refresh."; bad = true; }
    else if (csError === "busy") { msg = "Leetify is busy right now. Try again in a minute."; bad = true; }
    else if (csError === "down") { msg = "Couldn't reach Leetify. Check your internet connection and try again."; bad = true; }
    else if (p && p.privacy_mode && p.privacy_mode !== "public") { msg = "Your Leetify profile is private, so some stats may be hidden. You can make it public in Leetify's settings."; }
    $("csMsg").textContent = msg; $("csMsg").hidden = !msg; $("csMsg").classList.toggle("bad", bad);

    const ranks = $("csRanks"); ranks.replaceChildren();
    const rk = p && p.ranks;
    $("csRankHead").hidden = ranks.hidden = !rk;
    if (rk) {
      const box = (label, valueNode, sub) => {
        const b = mk("div", "rank"); b.append(mk("div", "role", label), valueNode); if (sub) b.append(mk("div", "role", sub)); ranks.append(b);
      };
      if (rk.premier) {
        const v = mk("span", "prem", Number(rk.premier).toLocaleString("en-US"));
        v.style.setProperty("--tier", PREMIER_TIERS.find(([max]) => rk.premier < max)[1]);
        const w = mk("div", "big"); w.append(v); box("Premier", w);
      } else box("Premier", mk("div", "big", "Unranked"));
      box("FACEIT", mk("div", "big", rk.faceit ? "Level " + rk.faceit : "—"), rk.faceit_elo ? Number(rk.faceit_elo).toLocaleString("en-US") + " Elo" : "");
      box("Leetify", mk("div", "big", rk.leetify == null ? "—" : signed(lrating(rk.leetify))), "rating");
      try { window.__csRank = rk.premier ? "Premier " + Number(rk.premier).toLocaleString("en-US") : rk.faceit ? "FACEIT " + rk.faceit : ""; D.gameRanks({ cs: window.__csRank }); } catch {}
    }

    const tiles = $("csStats"); tiles.replaceChildren();
    $("csStatHead").hidden = tiles.hidden = !p;
    if (p) {
      const rt = p.rating || {}, st = p.stats || {};
      const tile = (k, v, sub, wide) => { const t = mk("div", "tile" + (wide ? " wide" : "")); t.append(mk("div", "k", k), mk("div", "v", v)); if (sub) t.append(mk("div", "s", sub)); return t; };
      const wr = pct(p.winrate);
      const wt = tile("Win rate", wr == null ? "—" : (Math.round(wr * 10) / 10) + "%", `${p.total_matches ?? 0} matches`, true);
      const bar = mk("div", "wbar"); const fill = mk("i", wr != null && wr < 50 ? "low" : ""); fill.style.width = Math.max(0, Math.min(100, wr || 0)) + "%"; bar.append(fill); wt.append(bar);
      const score = v => v == null || isNaN(v) ? "—" : String(Math.round(v));
      const hs = pct(st.accuracy_head);
      tiles.append(wt,
        tile("Matches", String(p.total_matches ?? 0)),
        tile("Aim", score(rt.aim), "out of 100"),
        tile("Positioning", score(rt.positioning), "out of 100"),
        tile("Utility", score(rt.utility), "out of 100"),
        tile("Headshots", hs == null ? "—" : (Math.round(hs * 10) / 10) + "%", "of hits"),
        tile("Reaction", st.reaction_time_ms == null ? "—" : Math.round(st.reaction_time_ms) + " ms"),
        tile("Preaim", st.preaim == null ? "—" : (Math.round(st.preaim * 10) / 10) + "°", "lower is better"));
    }

    const list = $("csMatches"); list.replaceChildren();
    const ms = p && Array.isArray(p.recent_matches) ? p.recent_matches.slice(0, 6) : [];
    $("csMatchHead").hidden = list.hidden = !ms.length;
    ms.forEach(m => {
      const row = mk("div", "match");
      const o = String(m.outcome || "").toLowerCase();
      const cls = o.startsWith("w") ? "win" : o.startsWith("l") ? "loss" : "tie";
      row.append(mk("div", "res " + cls, cls === "win" ? "W" : cls === "loss" ? "L" : "T"));
      const mid = mk("div");
      const sc = Array.isArray(m.score) ? m.score.join(" – ") : "";
      const src = String(m.data_source || "").replace(/_/g, " ");
      mid.append(mk("div", "hn", mapName(m.map_name) + (sc ? "  " + sc : "")), mk("div", "hs", [cap(src), m.finished_at ? ago(Date.parse(m.finished_at)) : ""].filter(Boolean).join(" · ")));
      row.append(mid, mk("div", "hw", m.leetify_rating == null ? "" : signed(lrating(m.leetify_rating))));
      list.append(row);
    });

    $("csFoot").textContent = csBusy ? "Updating…" : c ? `Updated ${ago(c.at)} · stats by Leetify` : "";
    try { if (typeof game !== "undefined" && tab === "stats") renderAcct(); } catch {}
  }
  $("csRefresh").onclick = () => loadCS(true);
  $("csChange").onclick = () => { csEditing = true; renderCS(); $("csSteam").focus(); };
  $("csCancel").onclick = () => { csEditing = false; renderCS(); };
  $("csForm").addEventListener("submit", e => {
    e.preventDefault();
    const v = $("csSteam").value.trim();
    if (!/7656\d{13}/.test(v) && !/steamcommunity\.com\/id\/[^\/?#\s]+/i.test(v) && !/^[\w.-]{2,64}$/.test(v)) {
      $("csFormErr").textContent = "Paste your Steam profile link, like steamcommunity.com/id/yourname or steamcommunity.com/profiles/7656…";
      $("csFormErr").hidden = false;
      return;
    }
    $("csFormErr").hidden = true;
    CS.steam = v; store.set("cs.steam", v);
    csEditing = false; csError = "";
    loadCS(true);
  });

  /* ---------- Rainbow Six Siege (stats.cc data) ---------- */
  const R6 = { id: store.get("r6.id") || "", pl: ["ranked", "quick-match", "unranked"].includes(store.get("r6.pl")) ? store.get("r6.pl") : "ranked" };
  (() => {   // first run: take the profile pinned on the old stats.cc page
    if (R6.id) return;
    const m = String(store.get("r6.url") || "").match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (m) { R6.id = m[0].toLowerCase(); store.set("r6.id", R6.id); }
  })();
  let r6Cache = null;
  try { r6Cache = JSON.parse(store.get("r6.cache") || "null"); } catch {}
  let r6Busy = false, r6Error = "", r6Editing = false;
  const R6_MODE = { ranked: "ranked-bomb", "quick-match": "quick-match-bomb", unranked: "unranked-bomb" };
  const R6_PL_NAME = { ranked: "Ranked", "quick-match": "Quick Match", unranked: "Unranked" };
  const r6Cfg = () => (r6Cache && r6Cache.config) || { seasons: {}, ranks: {}, tiers: {}, ops: {}, maps: {}, current: "" };
  const slugName = s => String(s || "").replace(/^v\d+-/, "").split("-").map(cap).join(" ");
  const r6RankName = r => { const c = r6Cfg().ranks[r]; return c ? String(c.name).replace(/^(no rank|not ranked)$/i, "Unranked") : slugName(r) || "Unranked"; };
  const r6RankColor = r => { const c = r6Cfg().ranks[r], t = c && r6Cfg().tiers[c.tier]; return t ? t.color : ""; };
  const r6RankImg = (r, pos) => r ? `https://static.stats.cc/siege/ranks/${pos && /champion/.test(r) ? r.replace(/-i$/, "") + "-position-" + pos : r}-small.webp` : "";
  const r6Season = s => r6Cfg().seasons[s] || { name: slugName(s) };
  const r6Num = (v, d = 2) => v == null || isNaN(v) ? "—" : (Math.round(v * 10 ** d) / 10 ** d).toFixed(d);
  const r6Pct = v => v == null || isNaN(v) ? "—" : Math.round(v) + "%";
  const r6Img = (src, cls, onerr) => { const im = mk("img", cls || ""); im.alt = ""; im.referrerPolicy = "no-referrer"; im.src = src; im.onerror = onerr || (() => im.replaceWith(mk("div", "hph"))); return im; };

  async function loadR6(force) {
    if (!R6.id) { renderR6(); return; }
    const fresh = r6Cache && r6Cache.id === R6.id && r6Cache.pl === R6.pl && Date.now() - r6Cache.at < 10 * 60 * 1000;
    if (!force && fresh) { renderR6(); return; }
    if (r6Busy) return;
    r6Busy = true; r6Error = ""; renderR6();
    let r;
    try { r = await D.r6Get({ id: R6.id, playlist: R6.pl }); } catch { r = { error: "down" }; }
    r6Busy = false;
    const p = r && r.profile;
    if (!r || r.error) r6Error = r && r.error === "badinput" ? "notfound" : "down";
    else if (p.status === 404) r6Error = "notfound";
    else if (p.status === 429) r6Error = "busy";
    else if (p.status !== 200 || !p.json) r6Error = "down";
    else {
      r6Cache = {
        id: R6.id, pl: R6.pl, at: Date.now(), profile: p.json,
        matches: Array.isArray(r.matches && r.matches.json) ? r.matches.json.slice(0, 10) : [],
        operators: Array.isArray(r.operators && r.operators.json) ? r.operators.json : [],
        config: r.config || (r6Cache && r6Cache.config) || null
      };
      try { store.set("r6.cache", JSON.stringify(r6Cache)); } catch {}
      try { D.r6LiveMe({ name: p.json.username, platform: p.json.platform }); } catch {}
      try {
        const cur = (r.config && r.config.current) || "", rec = (p.json.ranked_season_records || {})[cur];
        if (rec && rec.rank && D.r6Rank) D.r6Rank({ name: (r.config.ranks[rec.rank] || {}).name || rec.rank, rp: /unranked/.test(rec.rank) ? null : rec.rank_points, img: `https://static.stats.cc/siege/ranks/${rec.rank}-small.webp` });
      } catch {}
    }
    renderR6();
  }

  function renderR6() {
    const setup = !R6.id || r6Editing;
    $("r6Setup").hidden = !setup;
    $("r6View").hidden = setup;
    $("r6Cancel").hidden = !R6.id;
    if (setup) return;
    document.querySelectorAll("#r6Mode button").forEach(b => b.setAttribute("aria-checked", b.dataset.pl === R6.pl));

    const c = r6Cache && r6Cache.id === R6.id ? r6Cache : null;
    const p = c && c.profile;
    const cfg = r6Cfg(), cur = cfg.current || (p && Object.keys(p.ranked_season_records || {}).pop()) || "";
    $("r6Name2").textContent = p ? p.username : "Rainbow Six player";
    $("r6Sub").textContent = p ? [p.level ? "Level " + p.level : "", { pc: "PC", xbox: "Xbox", playstation: "PlayStation" }[p.platform] || ""].filter(Boolean).join(" · ") : "Rainbow Six Siege";
    $("r6Av").src = `https://ubisoft-avatars.akamaized.net/${R6.id}/default_146_146.png`;
    $("r6Refresh").disabled = r6Busy;

    let msg = "", bad = false;
    if (r6Busy && !c) msg = "Loading your stats…";
    else if (r6Error === "notfound") { msg = "stats.cc couldn't find that profile. Press Change and search your Ubisoft name again."; bad = true; }
    else if (r6Error === "busy") { msg = "stats.cc is busy right now. Try again in a minute."; bad = true; }
    else if (r6Error === "down") { msg = "Couldn't reach stats.cc. Check your internet connection and try again."; bad = true; }
    else if (c && c.pl !== R6.pl) msg = "Loading " + R6_PL_NAME[R6.pl] + "…";
    $("r6Msg").textContent = msg; $("r6Msg").hidden = !msg; $("r6Msg").classList.toggle("bad", bad);

    // ranks: this season, season peak, best ever
    const ranks = $("r6Ranks"); ranks.replaceChildren();
    const recs = (p && p.ranked_season_records) || {};
    const now = recs[cur];
    $("r6RankHead").hidden = ranks.hidden = !p;
    if (p) {
      const box = (label, rank, pts, sub, pos) => {
        const b = mk("div", "rank");
        b.append(mk("div", "role", label));
        if (rank) b.append(r6Img(r6RankImg(rank, pos), "", function () { this.replaceWith(mk("div", "ph")); }));
        else b.append(mk("div", "ph"));
        const n = mk("div", "rk-name", rank ? r6RankName(rank) : "Unranked"); const col = r6RankColor(rank); if (col) n.style.setProperty("--tier", col);
        b.append(n, mk("div", "role", pts != null ? Number(pts).toLocaleString("en-US") + " RP" : sub || ""));
        if (pts != null && sub) b.append(mk("div", "role", sub));
        ranks.append(b);
      };
      box("Current", now && now.rank, now ? now.rank_points : null);
      box("Season peak", now && now.max_rank, now ? now.max_rank_points : null);
      const best = p.max_rank_season && recs[p.max_rank_season];
      box("Best ever", best && best.max_rank, best ? best.max_rank_points : null, best ? r6Season(p.max_rank_season).name : "", best && best.max_rank_position);
    }

    // this season's overview for the chosen playlist
    const tiles = $("r6Stats"); tiles.replaceChildren();
    const st = p && p.season_mode_records && p.season_mode_records[cur] && p.season_mode_records[cur][R6_MODE[R6.pl]];
    $("r6StatHead").textContent = (r6Season(cur).name || "This season") + " · " + R6_PL_NAME[R6.pl];
    $("r6StatHead").hidden = tiles.hidden = !p;
    if (p) {
      const tile = (k, v, sub, wide) => { const t = mk("div", "tile" + (wide ? " wide" : "")); t.append(mk("div", "k", k), mk("div", "v", v)); if (sub) t.append(mk("div", "s", sub)); return t; };
      if (!st || !st.matches) tiles.append(tile("Matches", "0", "No " + R6_PL_NAME[R6.pl] + " games this season yet", true));
      else {
        const wr = st.wr;
        const wt = tile("Win rate", r6Pct(wr), `${st.wins}W · ${st.losses}L${st.abandons ? " · " + st.abandons + " left" : ""}`, true);
        const bar = mk("div", "wbar"); const fill = mk("i", wr < 50 ? "low" : ""); fill.style.width = Math.max(0, Math.min(100, wr || 0)) + "%"; bar.append(fill); wt.append(bar);
        tiles.append(wt,
          tile("Matches", String(st.matches)),
          tile("K/D", r6Num(st.kd), `${st.kills} K · ${st.deaths} D`),
          tile("Headshots", r6Pct(st.hs), st.headshots + " total"),
          tile("Kills / match", r6Num(st.kpm, 1)),
          tile("KDA", r6Num(st.kda), st.assists + " assists"),
          tile("Kills", String(st.kills)),
          tile("Deaths", String(st.deaths)));
      }
    }

    // top operators by rounds played
    const ops = $("r6Ops"); ops.replaceChildren();
    const ol = c && c.pl === R6.pl ? c.operators.filter(o => o.rounds_played).sort((a, b) => b.rounds_played - a.rounds_played).slice(0, 5) : [];
    $("r6OpHead").hidden = ops.hidden = !ol.length;
    ol.forEach(o => {
      const row = mk("div", "hero");
      row.append(r6Img(`https://static.stats.cc/siege/operators/${o.operator}.svg`, "op"));
      const info = cfg.ops[o.operator] || {};
      const kd = o.deaths ? o.kills / o.deaths : o.kills;
      const mid = mk("div");
      mid.append(mk("div", "hn", info.name || slugName(o.operator)), mk("div", "hs", [info.side ? cap(info.side) : "", `${o.rounds_played} rounds`, `K/D ${r6Num(kd)}`].filter(Boolean).join(" · ")));
      const games = (o.wins || 0) + (o.losses || 0), wr = games ? o.wins / games * 100 : null;
      const right = mk("div", "hw", wr == null ? "—" : Math.round(wr) + "% WR");
      const bar = mk("div", "wbar"); const fill = mk("i", wr != null && wr < 50 ? "low" : ""); fill.style.width = Math.max(0, Math.min(100, wr || 0)) + "%"; bar.append(fill); right.append(bar);
      row.append(mid, right);
      ops.append(row);
    });

    // recent matches
    const list = $("r6Matches"); list.replaceChildren();
    const ms = c && c.pl === R6.pl ? c.matches.slice(0, 6) : [];
    $("r6MatchHead").hidden = list.hidden = !ms.length;
    ms.forEach(m => {
      const ps = m.player_summary || {}, rs = m.ranked_session;
      const o = String(ps.outcome || "");
      const cls = o === "win" ? "win" : o === "loss" ? "loss" : "tie";
      const row = mk("div", "match");
      row.append(mk("div", "res " + cls, cls === "win" ? "W" : cls === "loss" ? "L" : "–"));
      if (/^[a-z0-9-]+$/.test(m.map || "")) {
        const th = mk("img", "mthumb"); th.alt = ""; th.loading = "lazy"; th.referrerPolicy = "no-referrer";
        th.onerror = () => { th.style.visibility = "hidden"; };
        th.src = `https://static.stats.cc/siege/maps/${m.map}_thumbnail.webp`;
        row.classList.add("has-thumb"); row.append(th);
      }
      const mid = mk("div");
      const t = ps.team === 0 || ps.team === 1 ? ps.team : null;
      const sc = Array.isArray(m.scores) ? (t != null ? m.scores[t] + " – " + m.scores[1 - t] : m.scores.join(" – ")) : "";
      mid.append(mk("div", "hn", (cfg.maps[m.map] || slugName(m.map)) + (sc ? "  " + sc : "")),
        mk("div", "hs", [`${ps.kills ?? 0}/${ps.deaths ?? 0}/${ps.assists ?? 0}`, m.ended_at ? ago(Date.parse(m.ended_at)) : ""].filter(Boolean).join(" · ")));
      // The match that finishes your placements counts all your RP from 0, so show it as "Placed" instead
      let right;
      if (rs && /unranked/.test(rs.rank || "")) right = mk("div", "hw", "Placement");
      else if (rs && typeof rs.rank_points_delta === "number" && (Math.abs(rs.rank_points_delta) >= 500 || rs.rank_points_delta === rs.rank_points)) right = mk("div", "rpd up", "Placed " + Number(rs.rank_points).toLocaleString("en-US") + " RP");
      else if (rs && typeof rs.rank_points_delta === "number") { const d = rs.rank_points_delta; right = mk("div", "rpd " + (d > 0 ? "up" : d < 0 ? "down" : ""), (d > 0 ? "+" : "") + d.toLocaleString("en-US") + " RP"); }
      else right = mk("div", "hw", "K/D " + r6Num(ps.deaths ? ps.kills / ps.deaths : ps.kills));
      row.append(mid, right);
      list.append(row);
    });

    // past ranked seasons, newest first
    const sl = $("r6Seasons"); sl.replaceChildren();
    const order = s => { const x = cfg.seasons[s]; return x ? x.year * 10 + x.n : 0; };
    const past = Object.values(recs).filter(r => r.season !== cur && r.max_rank && !/unranked/.test(r.max_rank)).sort((a, b) => order(b.season) - order(a.season)).slice(0, 8);
    $("r6SeasonHead").hidden = sl.hidden = !past.length;
    past.forEach(r => {
      const row = mk("div", "hero season");
      row.append(r6Img(r6RankImg(r.max_rank, r.max_rank_position), "op"));
      const md = p.season_mode_records && p.season_mode_records[r.season] && p.season_mode_records[r.season]["ranked-bomb"];
      const mid = mk("div");
      const sn = r6Season(r.season);
      mid.append(mk("div", "hn", sn.name + (sn.year ? ` · Y${sn.year}S${sn.n}` : "")), mk("div", "hs", [md ? md.matches + " matches" : "", md ? "K/D " + r6Num(md.kd) : "", md ? r6Pct(md.wr) + " WR" : ""].filter(Boolean).join(" · ")));
      const right = mk("div", "hw");
      const n = mk("div", "rk-name", r6RankName(r.max_rank)); const col = r6RankColor(r.max_rank); if (col) n.style.setProperty("--tier", col);
      right.append(n, mk("div", "hs", Number(r.max_rank_points).toLocaleString("en-US") + " RP"));
      row.append(mid, right);
      sl.append(row);
    });

    $("r6Foot").textContent = r6Busy ? "Updating…" : c ? `Updated ${ago(c.at)} · stats from stats.cc` : "";
    try { if (typeof game !== "undefined" && tab === "stats") renderAcct(); } catch {}
  }
  document.querySelectorAll("#r6Mode button").forEach(b => b.addEventListener("click", () => {
    if (R6.pl === b.dataset.pl) return;
    R6.pl = b.dataset.pl; store.set("r6.pl", R6.pl); r6Error = ""; renderR6(); loadR6(false);
  }));
  $("r6Refresh").onclick = () => loadR6(true);
  $("r6Open").onclick = () => { const p = r6Cache && r6Cache.id === R6.id && r6Cache.profile; D.openExternal(`https://stats.cc/siege/${encodeURIComponent(p ? p.username : "-")}/${R6.id}`); };
  $("r6Change").onclick = () => { r6Editing = true; renderR6(); $("r6Name").focus(); };
  $("r6Cancel").onclick = () => { r6Editing = false; $("r6Results").hidden = true; renderR6(); };
  const r6Err = t => { $("r6FormErr").textContent = t; $("r6FormErr").hidden = !t; };
  function useR6(id) {
    R6.id = id.toLowerCase(); store.set("r6.id", R6.id);
    r6Editing = false; r6Error = ""; $("r6Results").hidden = true; r6Err("");
    loadR6(true);
  }
  $("r6Form").addEventListener("submit", async e => {
    e.preventDefault();
    const v = $("r6Name").value.trim();
    $("r6Results").hidden = true;
    const uuid = v.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (uuid) { useR6(uuid[0]); return; }
    if (v.length < 2) { r6Err("Type your Ubisoft name, or paste your stats.cc profile link."); return; }
    r6Err("Searching…");
    let r;
    try { r = await D.r6Search({ name: v, platform: $("r6Plat").value }); } catch { r = { status: 0, results: [] }; }
    if (!r.results.length) {
      r6Err(r.status && r.status !== 200 && r.status !== 404 ? `Search isn't working right now (error ${r.status}). Try again in a minute.` : `No players named ${v} were found on that platform.`);
      return;
    }
    r6Err("");
    const list = $("r6Results"); list.replaceChildren();
    r.results.forEach(p => {
      const row = mk("button", "hero"); row.type = "button";
      row.style.width = "100%"; row.style.textAlign = "left";
      row.append(r6Img(`https://ubisoft-avatars.akamaized.net/${p.id}/default_146_146.png`));
      const mid = mk("div");
      mid.append(mk("div", "hn", p.name), mk("div", "hs", [p.level ? "Level " + p.level : "", p.rank ? r6RankName(p.rank) + (p.rp != null ? " · " + p.rp + " RP" : "") : ""].filter(Boolean).join(" · ")));
      row.append(mid, mk("div", "hw", "Pick"));
      row.onclick = () => useR6(p.id);
      list.append(row);
    });
    list.hidden = false;
  });
  setInterval(() => { if (tab === "stats" && game === "r6") loadR6(false); }, 60000);

  /* ---------- Second account for each game: flip between two saved profiles ---------- */
  const ACC = {
    ow: {
      get: () => ({ tag: OWS.tag, platform: OWS.platform }),
      set: v => { OWS.tag = v.tag || ""; OWS.platform = v.platform || "pc"; store.set("ow.tag", OWS.tag); store.set("ow.platform", OWS.platform); owError = ""; owEditing = !OWS.tag; $("owPlat").value = OWS.platform; $("owTag").value = ""; renderOW(); if (OWS.tag) loadOW(false); },
      label: v => v.tag ? v.tag.split("#")[0] : ""
    },
    cs: {
      get: () => ({ steam: CS.steam, name: csCache && csCache.input === CS.steam ? csCache.name : "" }),
      set: v => { CS.steam = v.steam || ""; store.set("cs.steam", CS.steam); csError = ""; csEditing = !CS.steam; renderCS(); if (CS.steam) loadCS(false); },
      label: v => v.name || (v.steam ? "Steam" : "")
    },
    r6: {
      get: () => ({ id: R6.id, name: r6Cache && r6Cache.id === R6.id && r6Cache.profile ? r6Cache.profile.username : "" }),
      set: v => { R6.id = v.id || ""; store.set("r6.id", R6.id); r6Error = ""; r6Editing = !R6.id; $("r6Results").hidden = true; renderR6(); if (R6.id) loadR6(false); },
      label: v => v.name || (v.id ? "Ubisoft" : "")
    }
  };
  const accLoad = g => { try { const a = JSON.parse(store.get("acc." + g) || "null"); if (a && Array.isArray(a.list)) return a; } catch {} return { cur: 0, list: [{}, {}] }; };
  const accSave = (g, a) => store.set("acc." + g, JSON.stringify(a));
  function renderAcct() {
    if (!ACC[game]) return;
    const g = game, a = accLoad(g);
    a.list[a.cur] = Object.assign({}, a.list[a.cur], ACC[g].get());   // keep the active one up to date
    accSave(g, a);
    document.querySelectorAll("#acctSeg button").forEach(b => {
      const i = +b.dataset.i, lab = ACC[g].label(a.list[i] || {});
      b.setAttribute("aria-checked", i === a.cur);
      b.textContent = lab || (i === a.cur ? "Account " + (i + 1) : "+ Add account " + (i + 1));
      b.classList.toggle("add", !lab);
    });
  }
  document.querySelectorAll("#acctSeg button").forEach(b => b.addEventListener("click", () => {
    if (!ACC[game]) return;
    const g = game, a = accLoad(g), i = +b.dataset.i;
    if (i === a.cur) return;
    a.list[a.cur] = Object.assign({}, a.list[a.cur], ACC[g].get());
    a.cur = i; accSave(g, a);
    ACC[g].set(a.list[i] || {});
    renderAcct();
  }));
  setInterval(() => { if (tab === "stats") renderAcct(); }, 4000);   // pick up names once a profile has loaded

  /* ---------- Friends tab (inside Stats): your friends' ranks, separate from your own accounts ---------- */
  const FR_GAMES = { ow: "Overwatch", cs: "CS2", r6: "Rainbow Six Siege" };
  let friends = []; try { friends = JSON.parse(store.get("friends") || "[]") || []; } catch {}
  let frSel = store.get("fr.sel") || "", frEditId = null, frR6Pick = null;
  const frCache = {};   // "<friend>|<game>" -> { at, data }
  // who's online / in which game (Steam), refreshed every minute while you're on the Friends tab
  let frStat = {}, frStatAt = 0;
  async function frStatPoll(force) {
    const list = friends.filter(f => f.cs && f.cs.steam).map(f => ({ id: f.id, steam: f.cs.steam }));
    if (!list.length || (!force && Date.now() - frStatAt < 55000)) return;
    frStatAt = Date.now();
    try { frStat = (await D.frStatus(list)) || {}; } catch { return; }
    if (tab === "stats" && game === "fr") { frRender(); const f = frGet(frSel); if (f) { const st = frStat[f.id], el = $("frNow"); el.className = "fr-now" + (st ? " " + st.state : ""); el.textContent = !st ? "" : st.state === "in-game" ? "Playing " + (st.game || "a game") : st.state === "online" ? "Online" : "Offline"; } }
  }
  setInterval(() => { if (tab === "stats" && game === "fr") frStatPoll(); }, 15000);
  const frSave = () => store.set("friends", JSON.stringify(friends));
  const frGet = id => friends.find(f => f.id === id);
  const frHas = (f, g) => !!(f && f[g] && (g === "ow" ? f[g].tag : g === "cs" ? f[g].steam : f[g].id));
  function frRender() {
    const box = $("frBox"); box.replaceChildren();
    if (!frGet(frSel)) frSel = friends.length ? friends[0].id : "";
    friends.forEach(f => {
      const b = mk("button", "chip" + (frSel === f.id ? " on" : "")); b.type = "button"; b.setAttribute("role", "radio"); b.setAttribute("aria-checked", frSel === f.id);
      const st = frStat[f.id];
      if (st) { const dot = mk("i", "fr-dot " + st.state); b.append(dot); }
      b.append(document.createTextNode(f.name));
      if (st && st.state === "in-game" && st.game) b.append(mk("span", "fr-g", st.game));
      b.title = !st ? (f.cs && f.cs.steam ? "" : "Add their Steam account to see when they're online") : st.state === "in-game" ? "Playing " + (st.game || "a game") : st.state === "online" ? "Online on Steam" : "Offline";
      b.onclick = () => { frSel = f.id; store.set("fr.sel", frSel); frShow(); };
      box.append(b);
    });
    const add = mk("button", "chip add", "+ Add friend"); add.type = "button"; add.onclick = () => frOpen(null); box.append(add);
  }
  /* Leaderboard: you and your friends ranked by Overwatch (best role), Siege (RP) or CS2 (Premier) */
  let frBoardG = store.get("fr.board") || "ow", frBoardSeq = 0;
  const OW_DIV = ["bronze", "silver", "gold", "platinum", "emerald", "diamond", "master", "grandmaster", "champion"];
  async function frFetch(key, g, acct) {
    const c = frCache[key + "|" + g];
    if (c && Date.now() - c.at < 10 * 60000) return c.data;
    let data;
    try {
      data = g === "ow" ? await D.owGet({ tag: acct.tag, platform: acct.platform || "pc", mode: "competitive" })
        : g === "cs" ? await D.csGet({ steam: acct.steam })
        : await D.r6Get({ id: acct.id, playlist: "ranked" });
    } catch { data = { error: "down" }; }
    frCache[key + "|" + g] = { at: Date.now(), data };
    return data;
  }
  function frScore(g, data, plat) {
    try {
      if (g === "ow") {
        const comp = data.summary && data.summary.competitive && data.summary.competitive[plat === "console" ? "console" : "pc"]; if (!comp) return null;
        let best = null;
        for (const [k, l] of [["tank", "Tank"], ["damage", "Damage"], ["support", "Support"]]) { const r = comp[k]; if (!r || !r.division) continue; const sc = OW_DIV.indexOf(String(r.division).toLowerCase()) * 5 + (5 - (r.tier || 5)); if (!best || sc > best.sc) best = { sc, text: `${cap(r.division)} ${r.tier} ${l}`, img: httpsUrl(r.rank_icon) }; }
        return best;
      }
      if (g === "cs") { const r = data.leetify && data.leetify.status === 200 && data.leetify.json && data.leetify.json.ranks; return r && r.premier ? { sc: +r.premier, text: Number(r.premier).toLocaleString("en-US") + " Premier", img: "" } : null; }
      const p = data.profile && data.profile.json; if (!p) return null;
      const cfg = (data.config && data.config.json) || data.config || {}, recs = p.ranked_season_records || {}, cur = cfg.current || Object.keys(recs).pop() || "", now = recs[cur];
      if (!now || now.rank_points == null) return null;
      const nm = (cfg.ranks && cfg.ranks[now.rank] && String(cfg.ranks[now.rank].name).replace(/^(no rank|not ranked)$/i, "Unranked")) || String(now.rank || "").replace(/-/g, " ").replace(/\b\w/g, x => x.toUpperCase());
      return { sc: +now.rank_points, text: `${nm} · ${Number(now.rank_points).toLocaleString("en-US")} RP`, img: now.rank ? `https://static.stats.cc/siege/ranks/${now.rank}-small.webp` : "" };
    } catch { return null; }
  }
  async function frBoard() {
    const seq = ++frBoardSeq, g = frBoardG;
    const people = [];
    const mine = g === "ow" ? (OWS.tag ? { tag: OWS.tag, platform: OWS.platform } : null) : g === "cs" ? (CS.steam ? { steam: CS.steam } : null) : (R6.id ? { id: R6.id } : null);
    if (mine) people.push({ key: "me", name: "You", me: true, acct: mine });
    friends.forEach(f => { if (frHas(f, g)) people.push({ key: f.id, name: f.name, acct: f[g] }); });
    $("frBoard").hidden = !friends.length;
    const h = $("frBoardH"); h.replaceChildren(mk("b", "", "Leaderboard"));
    [["ow", "Overwatch"], ["r6", "Siege"], ["cs", "CS2"]].forEach(([k, l]) => { const c = mk("button", "chip" + (k === g ? " on" : ""), l); c.type = "button"; c.onclick = () => { frBoardG = k; store.set("fr.board", k); frBoard(); }; h.append(c); });
    const lb = $("frLb");
    if (people.length < 2) { lb.replaceChildren(mk("div", "fr-msg", "Add " + (g === "ow" ? "Overwatch" : g === "cs" ? "Steam" : "Siege") + " accounts for you and your friends to rank them here.")); return; }
    lb.replaceChildren(mk("div", "fr-msg", "Loading ranks…"));
    const rows = await Promise.all(people.map(async p => ({ p, s: frScore(g, await frFetch(p.key, g, p.acct), p.acct.platform) })));
    if (seq !== frBoardSeq) return;
    rows.sort((a, b) => (b.s ? b.s.sc : -1) - (a.s ? a.s.sc : -1));
    lb.replaceChildren();
    rows.forEach((r, i) => {
      const row = mk("div", "fr-lr" + (r.p.me ? " me" : ""));
      const im = mk("img"); im.alt = ""; if (r.s && r.s.img) { im.src = r.s.img; im.onerror = () => { im.style.visibility = "hidden"; }; } else im.style.visibility = "hidden";
      row.append(mk("span", "n", r.s ? String(i + 1) : "–"), mk("span", "who", r.p.name), mk("span", "rk", r.s ? r.s.text : "Unranked"), im);
      lb.append(row);
    });
  }
  function frShow(force) {
    frStatPoll(force);
    if (force) Object.keys(frCache).filter(k => k.startsWith("me|")).forEach(k => delete frCache[k]);
    frBoard();
    frRender();
    const f = frGet(frSel);
    $("frEmpty").hidden = !!friends.length;
    $("frWho").hidden = !f;
    $("frCards").replaceChildren();
    if (!f) return;
    $("frWhoName").textContent = f.name;
    { const st = frStat[f.id], el = $("frNow"); el.className = "fr-now" + (st ? " " + st.state : ""); el.textContent = !st ? "" : st.state === "in-game" ? "Playing " + (st.game || "a game") : st.state === "online" ? "Online" : "Offline"; }
    ["ow", "cs", "r6"].forEach(g => frCard(f, g, force));
  }
  const frRank = (k, img, v, sub) => { const r = mk("div", "fr-r"); r.append(mk("div", "k", k)); if (img) { const im = mk("img"); im.alt = ""; im.src = img; im.onerror = () => im.remove(); r.append(im); } r.append(mk("div", "v", v)); if (sub) r.append(mk("div", "s", sub)); return r; };
  async function frCard(f, g, force) {
    const card = mk("div", "fr-card"), head = mk("div", "fr-ch"), body = mk("div");
    const logo = mk("span", "glogo"); logo.dataset.logo = g;
    const sub = mk("span");
    head.append(logo, mk("b", "", FR_GAMES[g]), sub);
    card.append(head, body); $("frCards").append(card);
    if (!frHas(f, g)) {
      const m = mk("div", "fr-msg", "No " + FR_GAMES[g] + " account added.");
      const b = mk("button", "btn ghost", "Add it"); b.type = "button"; b.onclick = () => frOpen(f.id, g); m.append(b);
      body.append(m); return;
    }
    const key = f.id + "|" + g, c = frCache[key];
    let data = c && !force && Date.now() - c.at < 10 * 60000 ? c.data : null;
    if (!data) {
      body.append(mk("div", "fr-msg", "Loading…"));
      try {
        data = g === "ow" ? await D.owGet({ tag: f.ow.tag, platform: f.ow.platform || "pc", mode: "competitive" })
          : g === "cs" ? await D.csGet({ steam: f.cs.steam })
          : await D.r6Get({ id: f.r6.id, playlist: "ranked" });
      } catch { data = { error: "down" }; }
      frCache[key] = { at: Date.now(), data };
      if (frSel !== f.id || game !== "fr") return;
    }
    body.replaceChildren();
    const fail = t => body.append(mk("div", "fr-msg", t));
    try {
      if (g === "ow") {
        const sm = data && data.summary, plat = f.ow.platform === "console" ? "console" : "pc";
        if (!sm || data.error || !(sm.username || sm.competitive || sm.avatar)) return fail(data && data.private ? "Their Overwatch profile is private." : "Couldn't load their Overwatch profile. The BattleTag might be wrong, or the profile is private.");
        sub.textContent = f.ow.tag + (sm.endorsement && sm.endorsement.level ? " · Endorsement " + sm.endorsement.level : "");
        if (httpsUrl(sm.avatar)) { const av = mk("img", "av"); av.src = httpsUrl(sm.avatar); av.alt = ""; head.insertBefore(av, logo); logo.remove(); }
        const comp = sm.competitive && sm.competitive[plat];
        const rk = mk("div", "fr-rk");
        [["tank", "Tank"], ["damage", "Damage"], ["support", "Support"]].forEach(([k, l]) => { const r = comp && comp[k]; rk.append(frRank(l, r ? httpsUrl(r.rank_icon) : "", r ? `${cap(r.division)} ${r.tier}` : "Unranked")); });
        body.append(rk);
        const gen = data.stats && data.stats.general;
        if (gen && gen.games_played) { const wr = typeof gen.winrate === "number" ? gen.winrate : gen.games_won / gen.games_played * 100; body.append(mk("div", "fr-msg", `Competitive: ${Math.round(wr)}% win rate · ${gen.games_won ?? 0}W ${gen.games_lost ?? 0}L` + (gen.kda ? ` · ${(Math.round(gen.kda * 100) / 100).toFixed(2)} KDA` : ""))); }
      } else if (g === "cs") {
        if (!data || data.error) return fail(data && data.error === "notfound" ? "Couldn't find that Steam profile." : "Couldn't load their CS2 stats right now.");
        sub.textContent = data.name || "Steam";
        if (httpsUrl(data.avatar)) { const av = mk("img", "av"); av.src = httpsUrl(data.avatar); av.alt = ""; head.insertBefore(av, logo); logo.remove(); }
        const lf = data.leetify && data.leetify.status === 200 ? data.leetify.json : null;
        if (!lf) return fail(data.leetify && data.leetify.status === 404 ? "Leetify has no stats for them yet. They need to sign in at leetify.com once." : "Leetify isn't answering right now.");
        const r = lf.ranks || {}, rk = mk("div", "fr-rk");
        rk.append(frRank("Premier", "", r.premier ? Number(r.premier).toLocaleString("en-US") : "—"),
          frRank("FACEIT", "", r.faceit ? "Level " + r.faceit : "—", r.faceit_elo ? Number(r.faceit_elo).toLocaleString("en-US") + " Elo" : ""),
          frRank("Leetify", "", r.leetify == null ? "—" : (r.leetify > 0 ? "+" : "") + (Math.round(r.leetify * 100) / 100), "rating"));
        body.append(rk);
        if (lf.winrate != null) body.append(mk("div", "fr-msg", `${Math.round(lf.winrate * (lf.winrate <= 1 ? 100 : 1))}% win rate` + (lf.total_matches ? ` · ${lf.total_matches} matches` : "")));
      } else {
        const p = data && data.profile && data.profile.json;
        if (!p) return fail(data && data.profile && data.profile.status === 404 ? "stats.cc couldn't find that Siege profile." : "Couldn't reach stats.cc right now.");
        sub.textContent = [p.username, p.level ? "Level " + p.level : ""].filter(Boolean).join(" · ");
        const av = mk("img", "av"); av.alt = ""; av.src = `https://ubisoft-avatars.akamaized.net/${f.r6.id}/default_146_146.png`; av.onerror = () => av.remove(); head.insertBefore(av, logo); logo.remove();
        const cfg = (data.config && data.config.json) || data.config || {}, ranksCfg = cfg.ranks || {};
        const recs = p.ranked_season_records || {}, cur = cfg.current || Object.keys(recs).pop() || "", now = recs[cur];
        const rn = r => (ranksCfg[r] && String(ranksCfg[r].name).replace(/^(no rank|not ranked)$/i, "Unranked")) || (r ? String(r).replace(/-/g, " ").replace(/\b\w/g, x => x.toUpperCase()) : "Unranked");
        const img = r => r ? `https://static.stats.cc/siege/ranks/${r}-small.webp` : "";
        const st = p.season_mode_records && p.season_mode_records[cur] && p.season_mode_records[cur]["ranked-bomb"];
        const rk = mk("div", "fr-rk");
        rk.append(frRank("Current", img(now && now.rank), now && now.rank ? rn(now.rank) : "Unranked", now && now.rank_points != null ? Number(now.rank_points).toLocaleString("en-US") + " RP" : ""),
          frRank("Season peak", img(now && now.max_rank), now && now.max_rank ? rn(now.max_rank) : "—", now && now.max_rank_points != null ? Number(now.max_rank_points).toLocaleString("en-US") + " RP" : ""),
          frRank("K/D", "", st && st.kd != null ? (Math.round(st.kd * 100) / 100).toFixed(2) : "—", st ? `${st.wins ?? 0}W · ${st.losses ?? 0}L` : ""));
        body.append(rk);
      }
    } catch { fail("Couldn't show their stats."); }
  }
  function frOpen(id, focusGame) {
    const f = id ? frGet(id) : null;
    frEditId = id; frR6Pick = f && f.r6 && f.r6.id ? { id: f.r6.id, name: f.r6.name || "" } : null;
    $("frEditT").textContent = f ? "Edit " + f.name : "Add a friend";
    $("frName").value = f ? f.name : "";
    $("frOw").value = f && f.ow ? f.ow.tag || "" : ""; $("frOwPlat").value = f && f.ow && f.ow.platform === "console" ? "console" : "pc";
    $("frCs").value = f && f.cs ? f.cs.steam || "" : ""; $("frOwRes").replaceChildren();
    $("frR6").value = frR6Pick ? frR6Pick.name : ""; $("frR6Res").replaceChildren();
    $("frR6Hit").replaceChildren(); if (frR6Pick) $("frR6Hit").append(document.createTextNode("Linked: "), mk("b", "", frR6Pick.name || "Ubisoft account"));
    $("frDel").hidden = !f;
    $("frEdit").hidden = false;
    setTimeout(() => $(focusGame === "ow" ? "frOw" : focusGame === "cs" ? "frCs" : focusGame === "r6" ? "frR6" : "frName").focus(), 30);
  }
  $("frR6Find").onclick = async () => {
    const v = $("frR6").value.trim(), out = $("frR6Res"); out.replaceChildren();
    if (v.length < 2) return;
    out.append(mk("span", "fr-hit", "Searching stats.cc…"));
    let r = null; try { r = await D.r6Search({ name: v, platform: $("frR6Plat").value }); } catch {}
    out.replaceChildren();
    const list = r && r.results || [];
    if (!list.length) { out.append(mk("span", "fr-hit", r && r.status && r.status !== 200 ? "stats.cc isn't answering right now. Try again in a bit." : "No Siege players with that name.")); return; }
    list.forEach(pl => {
      const b = mk("button"); b.type = "button"; b.append(document.createTextNode(pl.name), mk("span", "", [pl.platform, pl.level ? "Level " + pl.level : "", pl.rank || ""].filter(Boolean).join(" · ")));
      b.onclick = () => { frR6Pick = { id: pl.id, name: pl.name }; out.replaceChildren(); $("frR6").value = pl.name; $("frR6Hit").replaceChildren(document.createTextNode("Linked: "), mk("b", "", pl.name)); };
      out.append(b);
    });
  };
  // Overwatch: a name or a Steam link is looked up and you pick the right player (Overwatch profiles go by BattleTag)
  $("frOwFind").onclick = async () => {
    let v = $("frOw").value.trim().replace(/\s*#\s*/, "#"); const out = $("frOwRes"); out.replaceChildren();
    if (/^[^#\s]{2,16}#\d{3,8}$/.test(v)) { out.append(mk("span", "fr-hit", "That's a full BattleTag, you're set.")); return; }
    if (v.length < 2) return;
    if (/steamcommunity\.com|^7656\d{13}$/i.test(v)) {   // Overwatch profiles only go by BattleTag, even for Steam players
      out.append(mk("span", "fr-hit", "Overwatch stats can't be found from a Steam link. Every Overwatch player (Steam too) has a BattleTag: ask them for it, or type the name they use in Overwatch and press Find."));
      return;
    }
    out.replaceChildren(mk("span", "fr-hit", "Searching Overwatch players named " + v + "…"));
    let r = null; try { r = await D.owSearch({ name: v.replace(/#.*$/, "") }); } catch {}
    out.replaceChildren();
    const list = r && r.results || [];
    if (!list.length) { out.append(mk("span", "fr-hit", "No public Overwatch profiles named " + v + ". Ask them for their BattleTag (Name#1234); their profile also has to be public.")); return; }
    list.slice(0, 8).forEach(pl => {
      const tag = String(pl.id || "").replace("-", "#");
      const b = mk("button"); b.type = "button"; b.append(document.createTextNode(tag), mk("span", "", [pl.title, pl.isPublic === false ? "Private" : ""].filter(Boolean).join(" · ")));
      b.onclick = () => { $("frOw").value = tag; out.replaceChildren(mk("span", "fr-hit", "Linked: " + tag)); };
      out.append(b);
    });
  };
  $("frOw").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); $("frOwFind").click(); } });
  $("frR6").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); $("frR6Find").click(); } });
  $("frR6").addEventListener("input", () => { if (frR6Pick && $("frR6").value.trim() !== frR6Pick.name) { frR6Pick = null; $("frR6Hit").textContent = "Press Find, then pick the right player."; } });
  $("frCancel").onclick = () => { $("frEdit").hidden = true; };
  $("frDel").onclick = () => {
    const b = $("frDel");
    if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Sure? Click again"; setTimeout(() => { b.dataset.sure = ""; b.textContent = "Remove friend"; }, 3000); return; }
    b.dataset.sure = ""; b.textContent = "Remove friend";
    friends = friends.filter(f => f.id !== frEditId); frSave();
    $("frEdit").hidden = true; frSel = ""; frShow();
  };
  $("frEdit").addEventListener("submit", e => {
    e.preventDefault();
    const name = $("frName").value.trim().slice(0, 30);
    if (!name) { $("frName").focus(); toast("Give your friend a name"); return; }
    const tag = $("frOw").value.trim().replace(/\s*#\s*/, "#");
    if (tag && !/^[^#\s]{2,16}#\d{3,8}$/.test(tag)) { $("frOwFind").click(); toast("Pick their Overwatch account from the list first"); return; }
    if ($("frR6").value.trim() && !frR6Pick) { $("frR6Find").click(); toast("Pick their Siege account from the list first"); return; }
    const f = frEditId ? frGet(frEditId) : { id: "f" + Date.now().toString(36) };
    Object.assign(f, { name, ow: tag ? { tag, platform: $("frOwPlat").value } : null, cs: $("frCs").value.trim() ? { steam: $("frCs").value.trim() } : null, r6: frR6Pick ? { id: frR6Pick.id, name: frR6Pick.name } : null });
    if (!frEditId) friends.push(f);
    frSave();
    Object.keys(frCache).forEach(k => { if (k.startsWith(f.id + "|")) delete frCache[k]; });
    $("frEdit").hidden = true; toast("Saved " + name);
    frSel = f.id; store.set("fr.sel", frSel); frShow();
  });
  $("frFirst").onclick = () => frOpen(null);
  $("frWhoEdit").onclick = () => frOpen(frSel);
  $("frRefresh").onclick = () => frShow(true);

  /* ---------- Minecraft server badge ---------- */
  const MC = { addr: store.get("mc.addr") || (D.personal && D.personal.mcAddr) || "", show: store.get("mc.show") !== "0" };
  let mcLast = null, mcBusy = false;
  async function loadMC() {
    if (!MC.show || !MC.addr || mcBusy) { renderMC(); return; }
    mcBusy = true; renderMC();
    try { mcLast = await D.mcGet({ address: MC.addr }); } catch { mcLast = { online: false, unreachable: true }; }
    mcLast = Object.assign({}, mcLast, { at: Date.now() });
    try { mcDiff(mcLast); } catch {}
    mcBusy = false; renderMC();
  }
  function renderMC() {
    const b = $("mcBadge"), r = mcLast, up = !!(r && r.online);
    b.hidden = !MC.show;
    $("setMc").setAttribute("aria-checked", MC.show);
    b.classList.toggle("up", up);
    b.classList.toggle("unknown", !up);
    b.classList.toggle("busy", mcBusy);
    $("mcCount").textContent = !r ? "–" : up ? String(r.players) : "off";
    $("mcMax").textContent = "";   // just the number online
    let tip = MC.addr + "\n";
    if (!r) tip += "Checking…";
    else if (r.error === "badaddress") tip += "That address doesn't look right. Fix it in Settings.";
    else if (!up) tip += "The server is offline or can't be reached.";
    else {
      tip += `${r.players} of ${r.max} players online`;
      if (r.names && r.names.length) tip += "\n" + r.names.slice(0, 12).join(", ") + (r.players > r.names.length ? ", …" : "");
      if (r.version) tip += "\nVersion " + r.version + (r.ping != null ? ` · ${r.ping} ms` : "");
    }
    tip += "\n" + (r && r.at ? "Updated " + ago(r.at) + ". " : "") + "Click to refresh.";
    b.dataset.tip = tip;
    $("mcStatus").textContent = mcBusy ? "Checking…" : !r ? "" : up ? `Online · ${r.players}/${r.max} players` : r.error === "badaddress" ? "Check the address." : "Offline or unreachable";
  }
  $("mcBadge").onclick = async () => { const ok = await D.modrinthOpen(); toast(ok ? "Opening Modrinth" : "Couldn't find the Modrinth App"); };
  $("setMc").onclick = () => { MC.show = !MC.show; store.set("mc.show", MC.show ? "1" : "0"); renderMC(); if (MC.show) loadMC(); };
  $("mcAddr").value = MC.addr;
  $("mcForm").addEventListener("submit", e => {
    e.preventDefault();
    const v = $("mcAddr").value.trim();
    if (!v) return;
    MC.addr = v; store.set("mc.addr", v); mcLast = null; loadMC();
  });
  renderMC();
  loadMC();
  setInterval(loadMC, 60000);


