  // ---------- Home dashboard (wide layout) ----------
  // Right of Stats: the Music Now playing view (art, then lyrics), then your library with its search. Left: the clock / game banner, a tile of the last game you played (click to launch it), Last opened modlist, Retro. Middle: the Stats page itself
  // (moved over from the Stats tab while you're on Home, and back again when you leave). Right: the side panel.
  // Only in the wide layout on Home; everywhere else Home and Stats look as before.
  (() => {
    // Sothis's Home is the Command Deck now (21-deck.js); this dashboard is only the old Game Launcher's
    if (!(D.role && D.role.role === "launcher")) return;
    const home = $("tab-home"), col = home && home.querySelector(".col.hm"), statsCol = document.querySelector("#tab-stats .col.statscol");
    if (!home || !col || !statsCol || !$("hx") || $("hdWrap")) return;
    // Sothis and the game launcher share this code. The launcher's Home: game banner, Last game, Last opened modlist,
    // Retro and Stats (no music). Sothis's Home: game banner and music (no Stats, games, modlists or retro: those moved).
    const LAUNCHER = !!(D.role && D.role.role === "launcher");
    statsCol.id = statsCol.id || "statsCol";

    const wrap = mk("div", "hd"); wrap.id = "hdWrap";
    const left = mk("div", "hd-l"), hxSlot = mk("div", "hd-slot"), mid = mk("div", "hd-m");
    mid.id = "hdStats";
    const card = (id, label) => { const c = mk("section", "hd-card"); c.id = id; c.setAttribute("aria-label", label); return c; };
    const gameCard = card("hdGame", "Last game"), mods = card("hdMods", "Last opened modlist"), retro = card("hdRetro", "Retro games");
    left.append(hxSlot, gameCard, mods, retro);
    const mu = mk("div", "hd-mu"); mu.id = "hdMusic";
    const lib = mk("div", "hd-lib"); lib.id = "hdLib";
    if (LAUNCHER) wrap.append(left, mid);
    else { left.replaceChildren(hxSlot); wrap.append(left, mu, lib); }
    home.append(wrap);

    const dur = s => { const m = Math.max(1, Math.round(s / 60)), h = Math.floor(m / 60); return h ? `${h}h ${m % 60}m` : `${m}m`; };
    const when = t => { const d = Date.now() - t; if (d < 3600000) return Math.max(1, Math.round(d / 60000)) + " min ago"; if (d < 86400000) return Math.round(d / 3600000) + "h ago"; if (d < 2 * 86400000) return "Yesterday"; return new Date(t).toLocaleDateString([], { month: "short", day: "numeric" }); };
    const head = (k, right) => { const h = mk("div", "hd-h"); h.append(mk("span", "hd-k", k)); if (right) h.append(mk("span", "hd-r", right)); return h; };
    const stat = (v, k) => { const d = mk("div", "hd-st"); d.append(mk("b", "", v), mk("span", "", k)); return d; };

    // Last game: a tile (no art) for the game you played last (from your game list, newest "played" first), click to launch
    let lastSess = null, week = null, games = null;
    function renderGame() {
      gameCard.replaceChildren();
      const list = (games || []).filter(g => !String(g.key || "").startsWith("web:"));
      let g = null;
      if (lastSess) g = list.find(x => x.name === lastSess.game) || null;
      if (!g) g = list.slice().sort((a, b) => (b.played || 0) - (a.played || 0))[0] || null;
      if (!g) { gameCard.append(head("Last game"), mk("p", "hd-empty", games ? "No games found yet." : "Looking for your games…")); return; }
      const t = mk("button", "hd-tile"); t.type = "button"; t.setAttribute("aria-label", "Launch " + g.name); t.title = "Launch " + g.name;
      const wk = week && Array.isArray(week.games) ? week.games.find(x => x.name === g.name || (lastSess && x.name === lastSess.game)) : null;
      const at = lastSess && lastSess.game === g.name ? lastSess.end : g.played;
      const tx = mk("div", "hd-tx");
      tx.append(mk("span", "hd-k", "Last played"), mk("b", "hd-t", g.name), mk("span", "hd-sub", [at ? when(at) : "", wk ? dur(wk.secs) + " this week" : "", g.store || ""].filter(Boolean).join(" · ")));
      const go = mk("span", "hd-play", "Play");
      t.append(tx, go);   // no picture, just the name
      t.onclick = () => gameOpen(g);
      gameCard.append(t);
    }
    async function loadGame() {
      try { lastSess = await D.sessionLast(); } catch {}
      try { week = await D.weekGet(0); } catch {}
      try { games = await D.gamesList(false); } catch { games = games || []; }
      renderGame();
    }

    // Last opened modlist: your Mod Organizer setups (Wabbajack lists included), newest first, with Launch
    let modList = null, modBusy = false;
    function renderMods() {
      mods.replaceChildren(head("Last opened modlist"));
      if (!modList) { mods.append(mk("p", "hd-empty", "Looking for your modlists…")); return; }
      if (!modList.length) { mods.append(mk("p", "hd-empty", "No Mod Organizer setups found.")); return; }
      const row = mk("div", "hd-modrow");
      const sel = mk("select", "hd-sel"); sel.setAttribute("aria-label", "Modlist, most recent first");
      modList.forEach(x => { const o = mk("option", "", x.name + " · " + x.game); o.value = x.id; sel.append(o); });
      try { const keep = store.get("hd.mod"); if (keep && modList.some(x => x.id === keep)) sel.value = keep; } catch {}
      sel.onchange = () => store.set("hd.mod", sel.value);
      const go = mk("button", "hd-btn hd-go", "Launch"); go.type = "button";
      go.onclick = async () => {
        const x = modList.find(y => y.id === sel.value); if (!x) return;
        go.disabled = true; const r = await D.mo2Open(x.id).catch(() => null); go.disabled = false;
        toast(r && r.ok ? "Opening " + x.name : (r && r.err) || "Couldn't open it");
        setTimeout(() => loadMods(true), 4000);
      };
      row.append(sel, go);
      mods.append(row);
    }
    async function loadMods(force) {
      if (modBusy) return; modBusy = true;
      try { const l = await D.mo2List(!!force); modList = (Array.isArray(l) ? l : []).slice().sort((a, b) => (b.at || 0) - (a.at || 0)); store.set("hd.mod", modList[0] ? modList[0].id : ""); } catch { modList = []; }
      modBusy = false; renderMods();
    }

    // Retro: your ROMs in a dropdown (last played first, then A–Z); Play opens the emulator in the Games tab
    let rtBusyHd = false, rtReady = false;
    function renderRetroHd() {
      retro.replaceChildren(head("Retro"));
      let groups = [];
      try { groups = rtGroups(); } catch {}
      if (!rtReady) { retro.append(mk("p", "hd-empty", "Looking for your game files…")); return; }
      if (!groups.length) { retro.append(mk("p", "hd-empty", "No ROMs found. Add a folder in Games → Retro.")); return; }
      groups.sort((a, b) => ((b.st && b.st.last) || 0) - ((a.st && a.st.last) || 0) || a.title.localeCompare(b.title));
      const row = mk("div", "hd-modrow");
      const sel = mk("select", "hd-sel"); sel.setAttribute("aria-label", "Retro game, last played first");
      groups.forEach(g => { const o = mk("option", "", g.title + " · " + g.sys); o.value = g.key; sel.append(o); });
      try { const keep = store.get("hd.rom"); if (keep && groups.some(g => g.key === keep)) sel.value = keep; } catch {}
      sel.onchange = () => store.set("hd.rom", sel.value);
      const go = mk("button", "hd-btn hd-go", "Play"); go.type = "button";
      go.onclick = async () => {
        const g = groups.find(y => y.key === sel.value); if (!g || !g.main) return;
        store.set("hd.rom", g.key);
        rtOpening = true;
        try { showTab("games"); await rtPlayGame(rtAsGame(g.main)); } catch { toast("Couldn't start it"); }
        rtOpening = false;
        if (!window.__rtPlaying && tab === "games") showTab("home");   // it opened in its own window, or didn't start
      };
      row.append(sel, go);
      retro.append(row);
    }
    async function loadRetroHd() {
      if (rtBusyHd) return; rtBusyHd = true;
      try { if (!rtData) rtData = await D.emuList(); } catch { rtData = rtData || { dirs: [], items: [] }; }
      try { if (!rtLib) rtLib = await D.libGet(false); } catch {}
      rtBusyHd = false; rtReady = true; renderRetroHd();
    }

    // Stats lives on Home now (the Stats tab is gone): in the wide layout it's the middle column, in a narrow
    // window it sits under the rest of Home.
    const narrowSlot = mk("div", "hd-narrow"); col.append(narrowSlot);
    let on = false, loaded = false, statsAt = "";
    function place() {
      const want = document.body.classList.contains("wd-has-side") && tab === "home";
      if (want !== on) {
        on = want;
        document.body.classList.toggle("hd-on", on);
        try { wdPut("hx", on ? hxSlot : null); } catch {}
        if (!LAUNCHER) try { wdPut("mnp", on ? mu : null); } catch {}
        if (!LAUNCHER) try { wdPut("ytlView", on ? lib : null); wdPut("ytsView", on ? lib : null); } catch {}   // your library and its search, right of the music   // the Music page's Now playing view: art, then lyrics under it
        if (on && !loaded && LAUNCHER) { loaded = true; loadGame(); loadMods(false); loadRetroHd(); }
      }
      const where = tab !== "home" || !LAUNCHER ? "" : on ? "mid" : "narrow";
      if (where !== statsAt) {
        statsAt = where;
        try { wdPut(statsCol.id, where === "mid" ? mid : where === "narrow" ? narrowSlot : null); } catch {}
        if (where) { try { showGame(game === "fr" ? "ow" : game); } catch {} }   // the Friends page is gone
      }
    }
    // no Stats or Games tab: their buttons, compact-sidebar buttons and Ctrl+3 / Ctrl+4 lead to Home.
    // The Games page stays behind the scenes only to show the retro player when you press Play on Home.
    let rtOpening = false;
    const showTabOrig = showTab;
    // The launcher keeps its Games tab (PC games, Retro, Releases, Mods); Stats is on its Home. Sothis has neither.
    showTab = function (t) {
      if (t === "stats" || t === "ytm" || (t === "games" && !LAUNCHER)) t = "home";
      return showTabOrig(t);
    };
    try { (LAUNCHER ? ["Open Stats", "Open Music"] : ["Open Stats", "Open Games", "Open Music"]).forEach(l => { const rb = document.querySelector('#rlTabs [aria-label="' + l + '"]'); if (rb) rb.remove(); }); } catch {}
    if (tab === "stats" || tab === "ytm" || (tab === "games" && !LAUNCHER)) showTab("home");
    // Sothis: the Music tab is gone, so start the music player and its library here instead of on first visit
    if (!LAUNCHER) try { if (musicSvc) msApply(); } catch {}
    // at start-up YouTube Music isn't ready yet, so the first library load fails with an error message under the
    // search bar: keep that message hidden and quietly try again every few seconds until your playlists load
    if (!LAUNCHER) (() => {
      const msg = $("ytlMsg"), list = $("ytlList"); if (!msg || !list) return;
      msg.classList.add("hd-quiet");
      let tries = 0;
      const t = setInterval(() => {
        if (list.children.length || ++tries > 20) { clearInterval(t); msg.classList.remove("hd-quiet"); return; }
        try { ytlLoad(true); } catch {}
      }, 3000);
    })();
    place(); setInterval(place, 400);
    setInterval(() => { if (on && LAUNCHER) loadGame(); }, 60000);
    if (LAUNCHER) try { D.onSession((k) => { if (k === "end") setTimeout(loadGame, 2000); }); } catch {}
  })();
