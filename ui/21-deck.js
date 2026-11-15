  // ---------- Command Deck: Sothis's look since Nov 2026 (styles in css/12-deck.css) ----------
  // One app again: games, retro, modlists, stats, Discord and music. Top bar: crest (glows like Blackwall's logo),
  // "Sothis" in the start-up animation's font with Blackwall's rolling shine, your own apps to launch (Blackwall, Braindance, Afterimage), tabs (Home,
  // Library, Stats, Music, Files), Update ready and the clock. Home is a grid of panels built from the parts
  // Home always had (game banner, Discord call, Now playing, session recap), plus Launch, Library and Retro.
  // Notes sit in a small block under Retro. The Files tab opens your downloads (MP4, MP3, photos, screenshots).
  // The old tab bar, rail and wide-layout side panel are off here.
  (() => {
    if (D.role && D.role.role === "launcher") return;
    const html = document.documentElement;
    html.classList.add("deck");
    const home = $("tab-home"), col = home && home.querySelector(".col.hm");
    if (!home || !col || $("dk")) return;

    // the wide layout's side panel would pull Now playing and the Discord call away from Home: put everything back, then keep it off
    try { wdPref = false; wdApply(); } catch {}
    try { wdApply = function () { document.body.classList.remove("wide", "wide-labels", "wd-has-side", "wd-ly"); const s = $("wdSide"); if (s) s.hidden = true; }; wdApply(); } catch {}

    const el = (tag, cls, txt) => { const e = mk(tag, cls, txt); return e; };
    const svg = (d, fill) => '<svg viewBox="0 0 24 24" width="16" height="16" fill="' + (fill ? "currentColor" : "none") + '" stroke="' + (fill ? "none" : "currentColor") + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + "</svg>";

    /* ===== top bar ===== */
    const tb = document.querySelector(".titlebar"), tbl = tb && tb.querySelector(".tb-left"), tbr = tb && tb.querySelector(".tb-right");
    const brand = el("div", "dk-brand");
    const crest = el("img", "dk-crest"); crest.alt = ""; crest.src = window.__brandCrest || "crest-bg.png";
    brand.append(crest, el("span", "dk-name", "Sothis"));
    const apps = el("div", "dk-apps"); apps.setAttribute("aria-label", "Your apps");
    const nav = el("nav", "dk-nav"); nav.setAttribute("aria-label", "Sothis");
    // Library holds PC games, Retro, Modlists and Releases as its own sub-tabs
    const NAV = [["home", "Home"], ["pc", "Library"], ["stats", "Stats"], ["ytm", "Music"], ["files", "Files"]];
    // Releases goes last in Library's sub-tabs
    try { const gm = $("gmMode"), rel = gm && gm.querySelector('[data-m="rel"]'); if (rel) gm.append(rel); } catch {}
    const navBtns = {};
    NAV.forEach(([k, l]) => { const b = el("button", "dk-tab", l); b.type = "button"; b.dataset.k = k; b.onclick = () => go(k); navBtns[k] = b; });
    // drag the tabs to put them in any order; the order is remembered
    const navOrder = () => { let o = []; try { o = JSON.parse(store.get("dk.navOrder") || "[]"); } catch {} return o.filter(k => navBtns[k]).concat(NAV.map(x => x[0]).filter(k => !o.includes(k))); };
    navOrder().forEach(k => nav.append(navBtns[k]));
    let dragK = "";
    for (const k in navBtns) {
      const b = navBtns[k]; b.draggable = true; b.title = "Drag to move";
      b.addEventListener("dragstart", e => { dragK = k; b.classList.add("dragging"); try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", k); } catch {} });
      b.addEventListener("dragend", () => { dragK = ""; b.classList.remove("dragging"); nav.querySelectorAll(".drop-l,.drop-r").forEach(x => x.classList.remove("drop-l", "drop-r")); });
      b.addEventListener("dragover", e => {
        if (!dragK || dragK === k) return; e.preventDefault();
        const r = b.getBoundingClientRect(), after = e.clientX > r.left + r.width / 2;
        b.classList.toggle("drop-r", after); b.classList.toggle("drop-l", !after);
      });
      b.addEventListener("dragleave", () => b.classList.remove("drop-l", "drop-r"));
      b.addEventListener("drop", e => {
        e.preventDefault(); if (!dragK || dragK === k) return;
        const r = b.getBoundingClientRect(), after = e.clientX > r.left + r.width / 2;
        after ? b.after(navBtns[dragK]) : b.before(navBtns[dragK]);
        b.classList.remove("drop-l", "drop-r");
        try { store.set("dk.navOrder", JSON.stringify([...nav.children].map(x => x.dataset.k))); } catch {}
      });
    }
    const upd = el("button", "dk-upd"); upd.type = "button"; upd.hidden = true; upd.innerHTML = svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>') + "<span>Update ready</span>";
    const clock = el("span", "dk-clock");
    const right = el("div", "dk-right"); right.append(upd, clock);
    if (tbl) { tbl.prepend(brand); brand.after(apps); }
    if (tb) { const mid = el("div", "dk-mid"); mid.append(nav); tbl ? tbl.after(mid) : tb.prepend(mid); }
    if (tbr) tbr.prepend(right);

    function go(k) {
      if (k === "files") {
        // your downloads (MP4 / MP3 from links, photos, screenshots, ROMs); opens on MP4 the first time
        try { if (!["mp3", "mp4", "photos", "shots", "roms"].includes(flKind)) { flKind = "mp4"; store.set("fl.kind", "mp4"); } } catch {}
        showTab("clips"); try { loadClips(); } catch {}
      } else if (["pc", "retro", "mods"].includes(k)) {
        // the Library tab opens on whichever sub-tab you were last on; Home's "All retro games" opens Retro
        if (k !== "pc") { try { gmMode = k; store.set("gm.mode", k); } catch {} }
        showTab("games");
        try { gmModeShow(); } catch {}
      } else showTab(k);
      navMark();
    }
    // the red highlight slides to the open tab
    const navInd = el("span", "dk-ind"); navInd.setAttribute("aria-hidden", "true"); nav.prepend(navInd);
    let navPrev = "";
    function navMark() {
      let cur = tab;
      if (tab === "games") cur = "pc";
      if (tab === "clips") cur = "files";
      for (const k in navBtns) navBtns[k].setAttribute("aria-current", k === cur ? "page" : "false");
      const on = navBtns[cur];
      if (on && on.offsetWidth) { navInd.style.width = on.offsetWidth + "px"; navInd.style.transform = "translateX(" + on.offsetLeft + "px)"; navInd.hidden = false; }
      else navInd.hidden = true;
      // Home's panels rise in one after another each time you come back to Home
      if (cur !== navPrev) { if (cur === "home" && navPrev) { try { const d = $("dk"); d.classList.remove("dk-enter"); void d.offsetWidth; d.classList.add("dk-enter"); clearTimeout(navMark.t); navMark.t = setTimeout(() => d.classList.remove("dk-enter"), 1400); } catch {} } navPrev = cur; }
    }
    setInterval(navMark, 300);
    const tick = () => { const d = new Date(); clock.textContent = "Online // " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); };
    tick(); setInterval(tick, 10000);

    // your own apps: icon buttons; one that isn't found yet asks for its .exe the first time
    async function loadApps() {
      let list = []; try { list = await D.myAppsList(); } catch {}
      apps.replaceChildren();
      for (const a of list || []) {
        const b = el("button", "dk-app" + (a.found ? "" : " missing")); b.type = "button";
        b.title = a.found ? "Open " + a.name : a.name + ": click to show Sothis where it is"; b.setAttribute("aria-label", "Open " + a.name);
        if (a.icon) { const im = el("img"); im.alt = ""; im.src = a.icon; b.append(im); } else b.append(el("span", "dk-app-i", a.short || a.name.slice(0, 2)));
        b.onclick = async () => { const r = await D.myAppsOpen(a.key).catch(() => null); if (r && r.ok) toast("Opening " + a.name); else if (!(r && r.cancelled)) toast("Couldn't open " + a.name); if (!a.found) loadApps(); };
        apps.append(b);
      }
    }
    loadApps();

    // Update ready: a new version is in place (live update) or downloaded from GitHub
    let updRestart = true;
    try { D.onUpdate(u => { updRestart = !!u.restart; upd.hidden = false; upd.title = updRestart ? "Restart Sothis to finish updating" : "Reload to see the changes"; }); } catch {}
    try { D.onUpd(u => { if (u && u.state === "ready") { updRestart = true; upd.hidden = false; upd.title = "Restart Sothis to update"; } }); } catch {}
    upd.onclick = () => { updRestart ? D.restartApp() : D.reloadApp(); };

    /* ===== Home: the deck ===== */
    const dk = el("div", "dk"); dk.id = "dk";
    const panel = (cls, title, sub) => {
      const p = el("section", "dk-p " + cls); p.setAttribute("aria-label", title);
      const h = el("h2", "dk-h"); h.append(el("span", "", title)); if (sub) { const s = el("span", "dk-hs", sub); h.append(s); p._sub = s; }
      p.append(h); return p;
    };
    const slotMove = (id, into) => { const n = $(id); if (n) into.append(n); return n; };

    // Launch: the live game banner (clock when nothing's running) + your last game, its modlist and Start
    const pLaunch = panel("dk-launch", "Ready to launch");
    const lArt = el("div", "dk-l-art"), lInfo = el("div", "dk-l-info");
    const lBody = el("div", "dk-l-body"); lBody.append(lArt, lInfo); pLaunch.append(lBody);
    slotMove("hx", lArt);
    // Audio: Now playing
    const pMusic = panel("dk-music", "Audio", "");
    const eq = el("span", "dk-eq"); eq.setAttribute("aria-hidden", "true"); eq.innerHTML = "<i></i><i></i><i></i><i></i>"; pMusic.querySelector(".dk-h").append(eq);
    setInterval(() => { try { eq.classList.toggle("on", !!(ytState && ytState.has && ytState.playing)); } catch {} }, 700);
    slotMove("hmNow", pMusic);
    const idle = el("p", "dk-note", "Nothing playing. Pick a song in Music.");
    pMusic.append(idle);
    setInterval(() => { const n = $("hmNow"); idle.hidden = !!(n && !n.hidden && n.offsetHeight > 0); }, 1000);
    const toMusic = el("button", "dk-link", "Open Music"); toMusic.type = "button"; toMusic.onclick = () => go("ytm"); pMusic.append(toMusic);
    // Comms: your Discord call
    const pComms = panel("dk-comms", "Comms // Discord");
    ["hmDcEmpty", "hmDc", "dcPins"].forEach(id => slotMove(id, pComms));
    // Library: Nintendo Switch (pops out) + your games, most recently played first
    const pLib = panel("dk-lib", "Library");
    const libList = el("div", "dk-list"); pLib.append(libList);
    const allG = el("button", "dk-link", "All games"); allG.type = "button"; allG.onclick = () => go("pc"); pLib.append(allG);
    // your session recap (and the live one while you play) sits under the Discord call
    ["sessLive", "hmSess"].forEach(id => slotMove(id, pComms));
    // Retro: last played first, with box art
    const pRetro = panel("dk-retro", "Retro", "");
    const rRow = el("div", "dk-rrow"); pRetro.append(rRow);
    const allR = el("button", "dk-link", "All retro games"); allR.type = "button"; allR.onclick = () => go("retro"); pRetro.append(allR);

    // Notes: a small block under Retro (Home's notes box, still saved as you type)
    const pNotes = panel("dk-notesp", "Notes");
    const notes = document.querySelector(".hm-notes");
    if (notes) {
      notes.id = notes.id || "hmNotesBox";
      // the old "Notes in the side panel" mover keeps putting it back on the old Home: leave it here
      try { const wdPutDeck = wdPut; wdPut = function (id, slot) { if (id === notes.id) return; return wdPutDeck(id, slot); }; } catch {}
      pNotes.append(notes);
      try { $("hmNotes").placeholder = "Codes, squad names, reminders…"; } catch {}   // (no phone remote any more)
    }
    const top = el("div", "dk-top"); slotMove("rmdOw", top);
    dk.append(top, pLaunch, pMusic, pComms, pLib, pRetro, pNotes);
    home.prepend(dk);

    // ---- Launch + Library data ----
    let games = null, lastSess = null, mods = null;
    const ago = t => { const d = Date.now() - t; if (d < 3600000) return Math.max(1, Math.round(d / 60000)) + " min ago"; if (d < 86400000) return Math.round(d / 3600000) + "h ago"; if (d < 2 * 86400000) return "yesterday"; return Math.round(d / 86400000) + " days ago"; };
    const realGames = () => (games || []).filter(g => !String(g.key || "").startsWith("web:"));
    function lastGame() {
      const list = realGames(); let g = null;
      if (lastSess) g = list.find(x => x.name === lastSess.game) || null;
      return g || list.slice().sort((a, b) => (b.played || 0) - (a.played || 0))[0] || null;
    }
    function renderLaunch() {
      lInfo.replaceChildren();
      const g = lastGame();
      if (!g) { lInfo.append(el("p", "dk-note", games ? "No games found yet." : "Looking for your games…")); return; }
      lInfo.append(el("span", "dk-k", "> Last played"), el("b", "dk-title", g.name));
      const at = lastSess && lastSess.game === g.name ? lastSess.end : g.played;
      lInfo.append(el("span", "dk-meta", "Source // " + [g.store, at ? ago(at) : ""].filter(Boolean).join(" · ")));
      // modlist: a Mod Organizer setup for this game, or none
      const mine = (mods || []).filter(m => m.game && (g.name.toLowerCase().includes(String(m.game).toLowerCase()) || String(m.game).toLowerCase().includes(g.name.toLowerCase())));
      let sel = null;
      if (mine.length) {
        const lab = el("label", "dk-loadout"); lab.append(el("span", "", "Modlist //"));
        sel = el("select", "dk-sel"); sel.setAttribute("aria-label", "Modlist");
        mine.forEach(m => { const o = el("option", "", m.name); o.value = m.id; sel.append(o); });
        const none = el("option", "", "No mods"); none.value = ""; sel.append(none);
        try { const keep = store.get("dk.load." + g.name); if (keep != null && [...sel.options].some(o => o.value === keep)) sel.value = keep; } catch {}
        sel.onchange = () => store.set("dk.load." + g.name, sel.value);
        lab.append(sel); lInfo.append(lab);
      }
      const row = el("div", "dk-btns");
      const start = el("button", "dk-start", "Start"); start.type = "button";
      start.onclick = async () => {
        if (sel && sel.value) { const r = await D.mo2Open(sel.value).catch(() => null); toast(r && r.ok ? "Opening " + sel.options[sel.selectedIndex].text : (r && r.err) || "Couldn't open it"); }
        else gameOpen(g);
      };
      const lib = el("button", "dk-ghost", "Library"); lib.type = "button"; lib.onclick = () => go("pc");
      row.append(start, lib); lInfo.append(row);
    }
    function renderLib() {
      libList.replaceChildren();
      // Nintendo Switch: opens the capture feed in its own window (only where the Switch feature is on)
      const swOn = !!$("tabbtn-switch") && !$("tabbtn-switch").hidden;
      if (swOn) {
        const r = el("button", "dk-row dk-sw"); r.type = "button"; r.title = "Opens the Switch feed in its own window";
        r.append(el("span", "dk-rn", "Nintendo Switch"), el("span", "dk-rs", "Capture · pop out"));
        r.onclick = () => { try { swStop(); } catch {} try { D.swPopout(); toast("Opening the Switch window"); } catch { toast("Couldn't open the Switch window"); } };
        libList.append(r);
      }
      const list = realGames().slice().sort((a, b) => (b.played || 0) - (a.played || 0)).slice(0, 8);
      if (!list.length) libList.append(el("p", "dk-note", games ? "No games found yet." : "Looking for your games…"));
      list.forEach(g => {
        const r = el("button", "dk-row"); r.type = "button"; r.title = "Launch " + g.name;
        r.append(el("span", "dk-rn", g.name), el("span", "dk-rs", g.store || ""));
        r.onclick = () => gameOpen(g);
        libList.append(r);
      });
    }
    async function loadGames() {
      try { lastSess = await D.sessionLast(); } catch {}
      try { games = await D.gamesList(false); } catch { games = games || []; }
      try { const l = await D.mo2List(false); mods = (Array.isArray(l) ? l : []).slice().sort((a, b) => (b.at || 0) - (a.at || 0)); } catch { mods = mods || []; }
      renderLaunch(); renderLib();
    }

    // ---- Retro ----
    let rtReadyDk = false;
    function renderRetro() {
      rRow.replaceChildren();
      let groups = []; try { groups = rtGroups(); } catch {}
      if (!rtReadyDk) { rRow.append(el("p", "dk-note", "Looking for your game files…")); return; }
      if (!groups.length) { rRow.append(el("p", "dk-note", "No ROMs found. Add a folder in Retro.")); return; }
      groups.sort((a, b) => ((b.st && b.st.last) || 0) - ((a.st && a.st.last) || 0) || a.title.localeCompare(b.title));
      if (pRetro._sub) pRetro._sub.textContent = groups.length + " games";
      groups.slice(0, 10).forEach(g => {
        const t = el("button", "dk-rt"); t.type = "button"; t.title = "Play " + g.title;
        const art = el("span", "dk-rt-art"); art.append(el("span", "dk-rt-i", g.sys));
        try { rtArt(g.main.token).then(u => { if (u) { const im = el("img"); im.alt = ""; im.src = u; art.replaceChildren(im); } }); } catch {}
        t.append(art, el("span", "dk-rt-n", g.title));
        t.onclick = async () => { try { gmMode = "retro"; store.set("gm.mode", "retro"); showTab("games"); gmModeShow(); await rtPlayGame(rtAsGame(g.main)); } catch { toast("Couldn't start it"); } navMark(); };
        rRow.append(t);
      });
    }
    async function loadRetro() {
      try { if (!rtData) rtData = await D.emuList(); } catch { rtData = rtData || { dirs: [], items: [] }; }
      try { if (!rtLib) rtLib = await D.libGet(false); } catch {}
      rtReadyDk = true; renderRetro();
    }

    loadGames(); loadRetro();
    setInterval(() => { if (tab === "home") loadGames(); }, 60000);
    try { D.onSession(k => { if (k === "end") setTimeout(loadGames, 2000); }); } catch {}

    /* ===== Settings: only what Sothis still has ===== */
    try { const k = document.querySelector("#tab-settings .keys"); if (k) k.textContent = "Ctrl+1 Home · Ctrl+2 Music · Ctrl+3 Games · Ctrl+4 Stats · Ctrl+, Settings"; } catch {}
    // Clips, the phone remote and Claude are gone from Sothis: their Settings sections go too
    try {
      for (const g of document.querySelectorAll("#tab-settings .group")) {
        const h = g.querySelector(":scope > h2"), t = h ? h.textContent.trim() : "";
        if (t !== "Clips" && t !== "Phone") continue;
        g.classList.add("role-off"); g.hidden = true;
        for (const c of document.querySelectorAll("#setNav .chip")) if (c.textContent.trim() === t) c.remove();
      }
    } catch {}
    // Music plays in the background from the start (there's no separate step to open it first)
    try { if (musicSvc) msApply(); } catch {}
    // a tab that doesn't exist here any more goes Home; Switch only opens as its own window now
    const showTabDeck = showTab;
    showTab = function (t) { if (t === "switch") { try { D.swPopout(); } catch {} t = "home"; } if (t === "web" || t === "opera") t = "home"; const r = showTabDeck(t); navMark(); return r; };
    if (tab === "switch") showTab("home");
    navMark();
    try { const d = $("dk"); d.classList.add("dk-enter"); setTimeout(() => d.classList.remove("dk-enter"), 1400); } catch {}
  })();
