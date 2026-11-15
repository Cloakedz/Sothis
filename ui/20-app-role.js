  // ---------- Which app this is: Sothis or the game launcher ----------
  // Both apps run this same code; the launcher's folder has a role.json that says so (D.role). Styles for each are in
  // css/11-app-role.css (the <html> element gets "role-sothis" or "role-launcher" before anything is drawn).
  // Sothis: everything (games, retro, modlists, stats, Discord, music…) in the Command Deck look (21-deck.js).
  // The launcher: Home (game banner, Last game, Last opened modlist, Retro, Stats), the Games tab and Discord.
  (() => {
    const R = D.role || { role: "sothis", name: "Sothis" };
    const LAUNCHER = R.role === "launcher", NAME = R.name || (LAUNCHER ? "Game Launcher" : "Sothis");
    const hideRow = id => { const el = $(id), row = el && el.closest(".setting"); if (row) { row.hidden = true; row.classList.add("role-off"); } };
    // Settings sections that belong to the other app: the section and its chip at the top both go
    const offGroups = LAUNCHER
      ? ["Updates", "Lighting", "Phone", "Clips", "Song pop-up", "Visualizer", "Mouse battery", "Minecraft server", "Server alerts", "Weather", "Features"]
      : [];   // Sothis has everything again (games, stats and Discord came back)
    const panel = $("tab-settings"), nav = $("setNav");
    if (panel) for (const g of panel.querySelectorAll(".group")) {
      const h = g.querySelector(":scope > h2"), t = h ? h.textContent.trim() : "";
      if (!offGroups.includes(t)) continue;
      g.classList.add("role-off"); g.hidden = true;
      if (nav) for (const c of nav.querySelectorAll(".chip")) if (c.textContent.trim() === t) c.remove();
    }
    // if the section that was open last is one of those, open the first one that's left
    try {
      const open = panel && [...panel.querySelectorAll(".group")].find(g => !g.classList.contains("set-off") && g.querySelector(":scope > h2"));
      if (!open || open.classList.contains("role-off")) { const c = nav && nav.querySelector(".chip"); if (c) c.click(); }
    } catch {}
    if (LAUNCHER) {
      // Gaming: only "Games it recognises" (match alert and music ducking stay with Sothis's music)
      ["setQp", "setDuckTalk", "setDuckGame", "setDaily", "setMini", "setShellA"].forEach(hideRow);   // (the daily start screen and mini player are Sothis's too)
      try { const k = document.querySelector("#tab-settings .keys"); if (k) k.textContent = "Ctrl+1 Home · Ctrl+3 Games · Ctrl+, Settings"; } catch {}
      try { const f = $("duckLvl") && $("duckLvl").closest(".form"); if (f) { f.hidden = true; f.classList.add("role-off"); } } catch {}
      // the name everywhere the window says it
      try { $("cqTitle").textContent = "Close " + NAME + "?"; } catch {}
      try { const s = document.querySelector("#cq .cq-sub"); if (s) s.textContent = "Quitting stops your Discord status and stats. Hiding keeps it running in the tray."; } catch {}
      try { const sr = document.querySelector(".titlebar h1 .sr"); if (sr) sr.textContent = NAME; } catch {}
      try { const rl = $("rlExpand"); if (rl) { rl.title = "Open " + NAME; rl.setAttribute("aria-label", "Open the full " + NAME + " window"); } } catch {}
      try { const gt = document.querySelector("#tabbtn-games"); if (gt) gt.hidden = false; } catch {}
      // Settings → Gaming says "Games <name> recognises"
      try { for (const n of document.querySelectorAll("#tab-settings .name, #tab-settings .desc, #tab-settings .hint, #tab-games span, #tab-games p")) for (const t of n.childNodes) if (t.nodeType === 3 && /\bSothis\b/.test(t.nodeValue)) t.nodeValue = t.nodeValue.replace(/(^|[^"“])\bSothis\b/g, "$1" + NAME); } catch {}   // (the Discord status keeps its "Sothis" name)
      // no music here: the mini player and compact sidebar are Sothis's
      try { if (w_compact) D.setCompact(false); if (mini) D.setMini(false); } catch {}
    }
    // a tab that isn't in this app goes to Home (the launcher keeps Games; neither app has the old Stats/Music tabs)
    const showTabRole = showTab;
    showTab = function (t) {
      if (LAUNCHER && ["ytm", "switch", "web", "opera", "claude", "dcapp", "clips"].includes(t)) t = "home";
      return showTabRole(t);
    };
    if (LAUNCHER && ["ytm", "switch", "web", "opera", "claude", "dcapp", "clips"].includes(tab)) showTab("home");
    // compact-sidebar buttons for tabs this app doesn't have
    try {
      const gone = LAUNCHER ? ["Open Music", "Open Switch", "Open Claude", "Open Browser"] : [];
      gone.forEach(l => { const rb = document.querySelector('#rlTabs [aria-label="' + l + '"]'); if (rb) rb.remove(); });
    } catch {}
  })();
