  /* ---------- Games tab ---------- */
  let gmAll = null, gmBusy = false, gmShowHidden = false;
  let gmHidden = []; try { gmHidden = JSON.parse(store.get("gm.hidden") || "[]") || []; } catch {}
  // server status dots (Ubisoft's status feed; steamstat.us for Steam and CS2), refreshed every 5 minutes
  let gmStatus = null, gmStatusAt = 0;
  const gmNorm = t => String(t || "").toLowerCase().replace(/[®™©:']/g, "").replace(/^tom clancys\s+/, "").replace(/\s+/g, " ").trim();
  function gmStatusFor(g) {
    if (!gmStatus) return null;
    const n = gmNorm(g.name);
    for (const [k, v] of Object.entries(gmStatus.ubi || {})) { const kn = gmNorm(k); if (kn && (kn === n || kn.startsWith(n) || n.startsWith(kn))) return v; }
    if (/counter-strike 2|counter strike 2|^cs2$/.test(n) && gmStatus.cs) return gmStatus.cs;
    if ((g.store === "Steam" || /^steam:/.test(g.key || "")) && gmStatus.steam) return gmStatus.steam;
    return null;
  }
  async function gmStatusLoad() {
    if (Date.now() - gmStatusAt < 5 * 60000) return; gmStatusAt = Date.now();
    try { gmStatus = await D.gameStatus(); } catch { return; }
    if (tab === "games" && !$("gmGrid").hidden) renderGames();
  }
  setInterval(() => { if (tab === "games") gmStatusLoad(); }, 60000);
  // up to 3 games pinned to the Home banner for one-click launching
  let gmPins = []; try { gmPins = JSON.parse(store.get("gm.pins") || "[]") || []; } catch {}
  function gmTogglePin(g) {
    const i = gmPins.findIndex(p => p.key === g.key);
    if (i >= 0) gmPins.splice(i, 1);
    else { if (gmPins.length >= 3) { toast("You can pin 3 games. Unpin one first"); return; } gmPins.push({ key: g.key, name: g.name, art: g.artAlt || g.art || "", launch: g.launch, url: g.url || "" }); }
    store.set("gm.pins", JSON.stringify(gmPins)); renderGames(); hxPinsFill();
  }
  function hxPinsFill() {
    const box = $("hxPins"); if (!box) return; box.replaceChildren();
    gmPins.forEach(p => {
      const b = mk("button", "hx-pin"); b.type = "button"; b.title = "Launch " + p.name;
      if (p.art) { const im = mk("img"); im.alt = ""; im.referrerPolicy = "no-referrer"; im.src = p.art; im.onerror = () => im.remove(); b.append(im); }
      b.append(mk("span", "", String(p.name || "").replace(/[®™©]/g, "").trim()));
      b.onclick = () => gameOpen(p);
      box.append(b);
    });
  }
  const gmSaveHidden = () => store.set("gm.hidden", JSON.stringify(gmHidden));
  function gmToggleHide(g) {
    const i = gmHidden.indexOf(g.key);
    if (i >= 0) { gmHidden.splice(i, 1); toast("Showing " + g.name); } else { gmHidden.push(g.key); toast("Hid " + g.name); }
    gmSaveHidden(); renderGames();
  }
  // games that run in the browser: listed with your PC games, opened in Sothis's Browser tab
  const WEB_GAMES = [];
  function webGameOpen(g) {
    try { showTab("web"); wbEnsure(); const t = wbTabs.find(x => x.url && x.url.startsWith(g.url)); if (t) wbSelect(t.id); else wbNewTab(g.url); toast("Opening " + g.name); } catch { D.openExternal(g.url); }
  }
  const gameOpen = async g => { if (g && g.url) return webGameOpen(g); const ok = await D.gameLaunch(g.launch); toast(ok ? "Launching " + g.name : "Couldn't launch " + g.name); };
  async function loadGames(force) {
    gmStatusLoad();
    if (gmBusy || (gmAll && !force)) return renderGames();
    gmBusy = true; $("gmRef").classList.add("spin");
    if (!gmAll) $("gmMsg").textContent = "Looking for your games…";
    try { gmAll = await D.gamesList(!!force); } catch { gmAll = []; }
    gmAll = (gmAll || []).filter(g => !String(g.key).startsWith("web:")).concat(WEB_GAMES.map(g => Object.assign({}, g)));
    gmBusy = false; $("gmRef").classList.remove("spin");
    renderGames();
  }
  function renderGames() {
    const fold = t => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();   // "poke" finds PokéBonk
    const q = fold($("gmQ").value.trim()), grid = $("gmGrid");
    const hiddenCount = (gmAll || []).filter(g => gmHidden.includes(g.key)).length;
    $("gmShowHidden").hidden = !hiddenCount || $("gmGrid").hidden;
    $("gmShowHidden").textContent = gmShowHidden ? "Done" : `Show hidden (${hiddenCount})`;
    const list = (gmAll || []).filter(g => (gmShowHidden || !gmHidden.includes(g.key)) && (!q || fold(g.name).includes(q)))
      .sort((a, b) => (gmPins.some(p => p.key === b.key) - gmPins.some(p => p.key === a.key)) || (b.played || 0) - (a.played || 0) || a.name.localeCompare(b.name));
    grid.replaceChildren();
    $("gmMsg").textContent = !gmAll ? "Looking for your games…" : !gmAll.length ? "No games found from Steam, Battle.net or Ubisoft Connect." : !list.length ? "No game matches that." : "";
    list.forEach(g => {
      const c = mk("button", "gm-card"); c.type = "button"; c.setAttribute("aria-label", "Launch " + g.name);
      const art = mk("div", "gm-art");
      if (g.art) {
        const im = mk("img"); im.alt = ""; im.loading = "lazy"; im.referrerPolicy = "no-referrer"; im.src = g.art;
        let tried = 0;
        im.onerror = async () => {
          tried++;
          if (tried === 1 && g.artAlt) { im.src = g.artAlt; im.classList.add("hdr"); return; }
          if (tried <= 2 && g.appid) { const u = await D.gameStoreArt(g.appid).catch(() => ""); if (u) { tried = 3; im.src = u; im.classList.add("hdr"); return; } }
          im.remove();
          if (g.logo) { const lg = mk("span", "glogo"); lg.dataset.logo = g.logo; art.append(lg); } else art.append(mk("span", "gm-init", g.name.slice(0, 2)));
        };
        art.append(im);
      } else if (g.logo) { const lg = mk("span", "glogo"); lg.dataset.logo = g.logo; art.append(lg); }
      else art.append(mk("span", "gm-init", g.name.slice(0, 2)));
      const isHid = gmHidden.includes(g.key);
      if (isHid) c.classList.add("is-hidden");
      const x = mk("span", "gm-x"); x.setAttribute("role", "button"); x.tabIndex = 0;
      x.setAttribute("aria-label", (isHid ? "Show " : "Hide ") + g.name);
      x.innerHTML = isHid ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
      x.onclick = e => { e.stopPropagation(); gmToggleHide(g); };
      x.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); gmToggleHide(g); } };
      c.addEventListener("contextmenu", e => { e.preventDefault(); gmToggleHide(g); });
      const pinned = gmPins.some(p => p.key === g.key);
      const pn = mk("span", "gm-pin" + (pinned ? " on" : "")); pn.setAttribute("role", "button"); pn.tabIndex = 0;
      pn.setAttribute("aria-label", (pinned ? "Unpin " : "Pin ") + g.name + " to Home"); pn.title = pinned ? "Unpin from Home" : "Pin to Home";
      pn.innerHTML = '<svg viewBox="0 0 24 24" fill="' + (pinned ? "currentColor" : "none") + '" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8 6.6 19.7l1.1-6.1L3.2 9.4l6.1-.8z"/></svg>';
      pn.onclick = e => { e.stopPropagation(); gmTogglePin(g); };
      pn.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); gmTogglePin(g); } };
      const gs = gmStatusFor(g);
      if (gs) { const d = mk("span", "gm-st " + gs.s); d.title = "Servers: " + (gs.s === "ok" ? "up" : gs.s === "maint" ? "maintenance" : gs.s === "warn" ? "having problems" : "down") + (gs.t ? " (" + gs.t + ")" : ""); art.append(d); }
      c.append(x, pn, art, mk("div", "gm-name", g.name), mk("div", "gm-store", g.store));
      c.onclick = () => gameOpen(g);
      grid.append(c);
    });
    if (!$("gmRetro").hidden) $("gmShowHidden").hidden = true;
    gmNewsFill();
  }
  // Game news: patch notes for your pinned games (or your most played ones), newest first
  let gmNewsSel = store.get("gm.news") || "", gmNewsKey = "";
  const gmAppId = g => g && (g.appid || (/^steam:(\d+)$/.exec(g.key || "") || [])[1]);
  function gmNewsFill() {
    if (!gmAll) return;
    const pinned = gmPins.map(p => gmAll.find(g => g.key === p.key)).filter(g => gmAppId(g));
    const top = gmAll.filter(g => gmAppId(g) && !gmHidden.includes(g.key)).sort((a, b) => (b.played || 0) - (a.played || 0));
    const games = (pinned.length ? pinned : top).slice(0, 3);
    $("gmNews").hidden = !games.length || $("gmGrid").hidden;   // only on the PC games page
    if (!games.length) return;
    if (!games.some(g => g.key === gmNewsSel)) gmNewsSel = games[0].key;
    const key = games.map(g => g.key).join(",") + "|" + gmNewsSel;
    if (key === gmNewsKey) return; gmNewsKey = key;
    const h = $("gmNewsH"); h.replaceChildren(mk("b", "", "Game news"));
    games.forEach(g => { const c = mk("button", "chip" + (g.key === gmNewsSel ? " on" : ""), g.name); c.type = "button"; c.onclick = () => { gmNewsSel = g.key; store.set("gm.news", gmNewsSel); gmNewsFill(); }; h.append(c); });
    const g = games.find(x => x.key === gmNewsSel), list = $("gmNewsList");
    list.replaceChildren(mk("div", "fr-msg", "Loading news…"));
    D.gameNews(gmAppId(g)).then(items => {
      if (gmNewsKey !== key) return;
      list.replaceChildren();
      if (!items || !items.length) { list.append(mk("div", "fr-msg", items ? "No news for " + g.name + " yet." : "Couldn't load the news. Check your internet.")); return; }
      items.slice(0, 3).forEach(n => {
        const b = mk("button", "gm-ni" + (Date.now() - n.at < 3 * 86400000 ? " new" : "")); b.type = "button"; b.title = "Read it here";
        b.append(mk("div", "t", n.title), mk("div", "m", [n.at ? new Date(n.at).toLocaleDateString([], { month: "short", day: "numeric" }) : "", n.feed].filter(Boolean).join(" · ")));
        if (n.text) b.append(mk("div", "x", n.text));
        b.onclick = () => newsPop(n);
        list.append(b);
      });
    }).catch(() => { list.replaceChildren(mk("div", "fr-msg", "Couldn't load the news.")); });
  }
  // game news opens in a pop-up over Sothis (its own little browser), with a button to open it in your real browser
  let npEl = null;
  function newsPop(n) {
    if (npEl) npEl.remove();
    const ov = mk("div", "np"); ov.setAttribute("role", "dialog"); ov.setAttribute("aria-label", n.title || "Game news");
    const box = mk("div", "np-box"), head = mk("div", "np-h"), t = mk("b", "", n.title || "Game news");
    const ext = mk("button", "btn ghost", "Open in browser"); ext.type = "button"; ext.onclick = () => D.openExternal(n.url);
    const x = mk("button", "wbtn", ""); x.type = "button"; x.setAttribute("aria-label", "Close");
    x.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    head.append(t, ext, x);
    const body = mk("div", "np-b"), load = mk("div", "np-load", "Loading…");
    const wv = document.createElement("webview");
    wv.setAttribute("partition", "persist:browser"); wv.setAttribute("src", n.url);
    wv.addEventListener("did-stop-loading", () => load.remove());
    wv.addEventListener("new-window", e => { try { D.openExternal(e.url); } catch {} });
    body.append(load, wv); box.append(head, body); ov.append(box);
    const close = () => { ov.classList.remove("on"); window.removeEventListener("keydown", key); setTimeout(() => ov.remove(), 220); if (npEl === ov) npEl = null; };
    const key = e => { if (e.key === "Escape") close(); };
    x.onclick = close; ov.addEventListener("mousedown", e => { if (e.target === ov) close(); }); window.addEventListener("keydown", key);
    document.body.append(ov); npEl = ov;
    requestAnimationFrame(() => ov.classList.add("on"));
  }
  $("gmQ").addEventListener("input", () => { if (!$("gmGrid").hidden) renderGames(); });
  $("gmRef").onclick = () => loadGames(true);
  $("gmShowHidden").onclick = () => { gmShowHidden = !gmShowHidden; renderGames(); };

  /* ---------- Minecraft server pop-up (hover the server badge) ---------- */
  let mcpT = null, mcpOpen = false;
  function mcpRender() {
    const r = mcLast, up = !!(r && r.online);
    $("mcpAddr").textContent = MC.addr || "Minecraft";
    $("mcpCount").textContent = !r ? "…" : up ? r.players + " online" : "Offline";
    $("mcpCount").classList.toggle("up", up && r.players > 0);
    $("mcpSub").textContent = !r ? "Checking…" : up ? [r.version, r.ping != null ? r.ping + " ms" : "", r.at ? "updated " + ago(r.at) : ""].filter(Boolean).join(" · ") : r.error === "badaddress" ? "Check the address in Settings" : "The server is offline or can't be reached";
    $("mcpMotd").textContent = up ? (r.motd || "") : "";
    const list = $("mcpList"); list.replaceChildren();
    if (up && r.names && r.names.length) {
      r.names.slice(0, 20).forEach(n => {
        const row = mk("div", "mcp-p"), im = mk("img"); im.alt = ""; im.loading = "lazy"; im.referrerPolicy = "no-referrer";
        im.src = "https://mc-heads.net/avatar/" + encodeURIComponent(n) + "/32"; im.onerror = () => im.removeAttribute("src");
        row.append(im, document.createTextNode(n)); list.append(row);
      });
      if (r.players > r.names.length) list.append(mk("div", "mcp-more", "+ " + (r.players - r.names.length) + " more"));
    } else if (up && r.players > 0) list.append(mk("div", "mcp-more", "The server doesn't share player names."));
  }
  function mcpShow() {
    clearTimeout(mcpT); mcpRender();
    const pop = $("mcPop");
    const b = $("mcBadge").getBoundingClientRect(), sh = $("shell").getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(b.left - sh.left, sh.width - 258)) + "px";
    if (!mcpOpen) { mcpOpen = true; pop.hidden = false; requestAnimationFrame(() => pop.classList.add("on")); }
  }
  function mcpHide(delay) {
    clearTimeout(mcpT);
    mcpT = setTimeout(() => { mcpOpen = false; const pop = $("mcPop"); pop.classList.remove("on"); setTimeout(() => { if (!mcpOpen) pop.hidden = true; }, 180); }, delay ?? 160);
  }
  $("mcBadge").addEventListener("mouseenter", mcpShow);
  $("mcBadge").addEventListener("mouseleave", () => mcpHide());
  $("mcBadge").addEventListener("focus", mcpShow);
  $("mcBadge").addEventListener("blur", () => mcpHide(0));
  $("mcPop").addEventListener("mouseenter", () => clearTimeout(mcpT));
  $("mcPop").addEventListener("mouseleave", () => mcpHide());
  setInterval(() => { if (mcpOpen) mcpRender(); }, 5000);

  /* ---------- Weather chip (Open-Meteo) ---------- */
  const WX_IC = {
    sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
    part: '<path d="M8 3.5v1.6M3.5 8h1.6M4.8 4.8l1.1 1.1M12.6 5.4A4 4 0 0 0 5.7 10"/><path d="M8.5 20h9a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.6A3.2 3.2 0 0 0 8.5 20z"/>',
    partn: '<path d="M12.5 4.2a4.6 4.6 0 0 1-6.3 6.3 4.6 4.6 0 0 0 6.3-6.3z"/><path d="M8.5 20h9a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.6A3.2 3.2 0 0 0 8.5 20z"/>',
    cloud: '<path d="M7 19h10.5a4.5 4.5 0 0 0 .5-9 6 6 0 0 0-11.6 1.8A3.6 3.6 0 0 0 7 19z"/>',
    fog: '<path d="M7 14h10.5a4.5 4.5 0 0 0 .5-9 6 6 0 0 0-11.6 1.8A3.6 3.6 0 0 0 7 14z"/><path d="M4 18h16M7 21.5h10"/>',
    rain: '<path d="M7 15h10.5a4.5 4.5 0 0 0 .5-9 6 6 0 0 0-11.6 1.8A3.6 3.6 0 0 0 7 15z"/><path d="M8.5 18l-1 3M12.5 18l-1 3M16.5 18l-1 3"/>',
    snow: '<path d="M7 15h10.5a4.5 4.5 0 0 0 .5-9 6 6 0 0 0-11.6 1.8A3.6 3.6 0 0 0 7 15z"/><path d="M8 18.5h.01M12 20.5h.01M16 18.5h.01M10 22h.01M14 22h.01" stroke-width="2.6"/>',
    storm: '<path d="M7 15h10.5a4.5 4.5 0 0 0 .5-9 6 6 0 0 0-11.6 1.8A3.6 3.6 0 0 0 7 15z"/><path d="M12.5 15l-2 3.5h3l-2 3.5"/>'
  };
  const wxKind = (c, day) => c === 0 || c === 1 ? (day ? "sun" : "moon") : c === 2 ? (day ? "part" : "partn") : c === 3 ? "cloud" : c === 45 || c === 48 ? "fog" : (c >= 71 && c <= 77) || c === 85 || c === 86 ? "snow" : c >= 95 ? "storm" : c >= 51 ? "rain" : "cloud";
  const WX_TXT = { 0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Cloudy", 45: "Fog", 48: "Freezing fog", 51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle", 56: "Freezing drizzle", 57: "Freezing drizzle", 61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain", 71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains", 80: "Showers", 81: "Showers", 82: "Heavy showers", 85: "Snow showers", 86: "Heavy snow showers", 95: "Thunderstorms", 96: "Storms with hail", 99: "Storms with hail" };
  const wxSvg = (c, day) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + WX_IC[wxKind(c, day)] + "</svg>";
  const deg = v => isFinite(v) ? Math.round(v) + "°" : "--°";
  let wxCfg = { on: true, unit: "F", loc: null }, wxData = null, wxT = null, wxOpen = false;
  function wxChip() {
    const b = $("wxBadge"); b.hidden = !wxCfg.on;
    if (!wxCfg.loc) { b.classList.add("unknown"); $("wxIc").innerHTML = wxSvg(3, true).replace("<svg", '<svg class="wx-ic"'); $("wxT").textContent = ""; b.classList.add("nocity"); b.title = "Pick your city for weather"; return; }
    b.classList.remove("nocity");
    const n = wxData && wxData.now;
    b.classList.toggle("unknown", !n);
    $("wxIc").innerHTML = (n ? wxSvg(n.code, n.day) : wxSvg(3, true)).replace("<svg", '<svg class="wx-ic"');
    $("wxT").textContent = n ? deg(n.t) : "--°";
    b.title = "";
  }
  function wxRender() {
    const d = wxData;
    $("wxpPlace").textContent = wxCfg.loc ? wxCfg.loc.name : "Weather";
    if (!wxCfg.loc) { $("wxpNow").textContent = ""; $("wxpSub").textContent = "Click to pick your city in Settings."; $("wxpHrs").replaceChildren(); $("wxpDays").replaceChildren(); return; }
    if (!d || !d.now) { $("wxpNow").textContent = "—"; $("wxpSub").textContent = d && d.err ? "Couldn't get the weather right now." : "Loading…"; $("wxpHrs").replaceChildren(); $("wxpDays").replaceChildren(); return; }
    const n = d.now, sp = d.unit === "F" ? "mph" : "km/h";
    $("wxpNow").innerHTML = wxSvg(n.code, n.day) + deg(n.t);
    $("wxpSub").textContent = [WX_TXT[n.code] || "", "feels " + deg(n.feels), isFinite(n.hum) ? n.hum + "% humidity" : "", isFinite(n.wind) ? Math.round(n.wind) + " " + sp + " wind" : ""].filter(Boolean).join(" · ") + (d.stale ? " (not updated)" : "");
    const hrs = $("wxpHrs"); hrs.replaceChildren();
    (d.hours || []).filter((_, i) => i % 2 === 0).slice(0, 6).forEach((h, i) => {
      const c = mk("div", "wx-h"), hr = new Date(h.time).getHours();
      c.append(mk("span", "", i === 0 ? "Now" : (hr % 12 || 12) + (hr < 12 ? "a" : "p")));
      const ic = mk("span"); ic.innerHTML = wxSvg(h.code, h.day); c.append(ic, mk("b", "", deg(h.t)), mk("i", "", h.rain >= 20 ? h.rain + "%" : ""));
      hrs.append(c);
    });
    const days = $("wxpDays"); days.replaceChildren();
    (d.days || []).forEach((x, i) => {
      const r = mk("div", "wx-d"), ic = mk("span"); ic.innerHTML = wxSvg(x.code, true);
      const name = i === 0 ? "Today" : new Date(x.date + "T12:00").toLocaleDateString(undefined, { weekday: "short" });
      const hl = mk("em"); hl.append(document.createTextNode(deg(x.hi) + " "), mk("s", "", deg(x.lo)));
      r.append(mk("b", "", name), ic, mk("span", "", (WX_TXT[x.code] || "") + (x.rain >= 30 ? " · " + x.rain + "%" : "")), hl);
      days.append(r);
    });
  }
  async function wxLoad(force) {
    if (!wxCfg.on || !wxCfg.loc) { wxChip(); return; }
    try { wxData = await D.wxGet(!!force); } catch { wxData = { err: true }; }
    wxChip(); if (wxOpen) wxRender();
  }
  function wxShow() {
    clearTimeout(wxT); wxRender();
    const pop = $("wxPop"), b = $("wxBadge").getBoundingClientRect(), sh = $("shell").getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(b.left - sh.left, sh.width - 270)) + "px";
    if (!wxOpen) { wxOpen = true; pop.hidden = false; requestAnimationFrame(() => pop.classList.add("on")); }
  }
  function wxHide(delay) { clearTimeout(wxT); wxT = setTimeout(() => { wxOpen = false; const pop = $("wxPop"); pop.classList.remove("on"); setTimeout(() => { if (!wxOpen) pop.hidden = true; }, 180); }, delay ?? 160); }
  $("wxBadge").addEventListener("mouseenter", wxShow);
  $("wxBadge").addEventListener("mouseleave", () => wxHide());
  $("wxBadge").addEventListener("focus", wxShow);
  $("wxBadge").addEventListener("blur", () => wxHide(0));
  $("wxPop").addEventListener("mouseenter", () => clearTimeout(wxT));
  $("wxPop").addEventListener("mouseleave", () => wxHide());
  $("wxBadge").onclick = () => {
    if (wxCfg.loc) { wxLoad(true); return; }
    wxHide(0); $("setBtn").click();
    setTimeout(() => { $("wxGroup").dispatchEvent(new Event("settab")); $("wxCity").focus(); }, 350);
  };
  function wxSettings() {
    $("setWx").setAttribute("aria-checked", wxCfg.on);
    document.querySelectorAll("#wxUnit button").forEach(b => b.setAttribute("aria-checked", b.dataset.u === wxCfg.unit));
    $("wxUnitDesc").textContent = wxCfg.unit === "F" ? "Fahrenheit and mph." : "Celsius and km/h.";
    $("wxNow").textContent = wxCfg.loc ? "· now " + wxCfg.loc.name + (wxCfg.loc.region ? ", " + wxCfg.loc.region : "") : "";
  }
  async function wxSetCfg(c) { try { wxCfg = await D.wxCfg(c); } catch {} wxData = null; wxSettings(); wxChip(); wxLoad(true); }
  $("setWx").onclick = () => wxSetCfg({ on: !wxCfg.on });
  document.querySelectorAll("#wxUnit button").forEach(b => b.onclick = () => wxSetCfg({ unit: b.dataset.u }));
  $("wxForm").onsubmit = async e => {
    e.preventDefault();
    const q = $("wxCity").value.trim(), box = $("wxRes"); box.replaceChildren();
    if (q.length < 2) return;
    box.append(mk("span", "hint", "Searching…"));
    let r = null; try { r = await D.wxFind(q); } catch {}
    box.replaceChildren();
    if (!r) { box.append(mk("span", "hint", "Couldn't search right now. Check your internet.")); return; }
    if (!r.length) { box.append(mk("span", "hint", "No places found with that name.")); return; }
    r.forEach(p => {
      const b = mk("button"); b.type = "button"; b.append(document.createTextNode(p.name), mk("span", "", p.region));
      b.onclick = () => { box.replaceChildren(); $("wxCity").value = ""; wxSetCfg({ loc: p }); toast("Weather set to " + p.name); };
      box.append(b);
    });
  };
  // keep the chips from running under the window buttons
  function tbFit() {
    const tb = document.querySelector(".titlebar"); if (!tb) return;
    tb.classList.remove("tight");
    const kids = [...document.querySelectorAll(".tb-left > *")].filter(x => x.offsetParent), r = [...document.querySelectorAll(".tb-right > *")].filter(x => x.offsetParent);
    if (!kids.length || !r.length) return;
    const right = Math.max(...kids.map(x => x.getBoundingClientRect().right)), left = Math.min(...r.map(x => x.getBoundingClientRect().left));
    if (right > left - 6) tb.classList.add("tight");
  }
  try { const ro = new ResizeObserver(() => requestAnimationFrame(tbFit)); document.querySelectorAll(".tb-left > *, .tb-right > *, .titlebar").forEach(x => ro.observe(x)); } catch {}
  D.wxCfg().then(c => { if (c) wxCfg = c; wxSettings(); wxChip(); wxLoad(); }).catch(() => {});
  setInterval(() => wxLoad(), 15 * 60 * 1000);
  /* ---------- Background darkness (Settings → Window) ---------- */
  function shellA(v) { v = Math.max(0, Math.min(100, Math.round(+v))); if (!isFinite(v)) v = 70; document.documentElement.style.setProperty("--shell-a", (v / 100).toFixed(2)); $("setShellA").value = v; $("setShellAV").textContent = v + "%"; return v; }
  shellA(store.get("shell.a") ?? 70);
  $("setShellA").addEventListener("input", () => store.set("shell.a", String(shellA($("setShellA").value))));

  /* ---------- Accent color and your own logo (Settings → Window) ---------- */
  const DEF_ACCENT = "#ff4d73";
  function hexRgb(h) { const m = /^#?([0-9a-f]{6})$/i.exec(h || ""); if (!m) return null; const n = parseInt(m[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function setAccent(h) {
    const rgb = hexRgb(h) || hexRgb(DEF_ACCENT), root = document.documentElement.style;
    if (!hexRgb(h) || h.toLowerCase() === DEF_ACCENT) { ["--accent", "--glow", "--accent-ink"].forEach(k => root.removeProperty(k)); $("setAccent").value = DEF_ACCENT; return DEF_ACCENT; }
    const lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
    root.setProperty("--accent", h); root.setProperty("--glow", `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, .22)`); root.setProperty("--accent-ink", lum > 0.6 ? "#14060a" : "#ffffff");
    $("setAccent").value = h; return h;
  }
  setAccent(store.get("brand.accent") || DEF_ACCENT);
  $("setAccent").addEventListener("input", () => store.set("brand.accent", setAccent($("setAccent").value)));
  $("setAccentReset").onclick = () => { store.set("brand.accent", setAccent(DEF_ACCENT)); };
  function brandApply(b) {
    const logo = b && b.logo;
    document.documentElement.style.setProperty("--crest", logo ? `url("${logo}")` : 'url("crest-bg.png")');
    const crest = logo || "crest-bg.png";
    document.querySelectorAll('img.logo').forEach(i => { i.src = logo || "logo.png"; });
    document.querySelectorAll('#splash > img, img.cq-crest, #rlExpand img').forEach(i => { i.src = crest; });
    $("setLogoPrev").src = crest;
    $("setLogoReset").hidden = !logo;
    window.__brandCrest = crest;
    store.set("brand.logo", logo || "");
  }
  if (store.get("brand.logo")) brandApply({ logo: store.get("brand.logo") });   // straight away, so the start-up screen shows it too
  D.brandGet().then(brandApply).catch(() => {});
  D.onBrand(brandApply);
  $("setLogoPick").onclick = async () => { const b = await D.brandPickLogo(); brandApply(b); if (b && b.err) toast(b.err); else if (b && b.logo) toast("Logo changed"); };
  $("setLogoReset").onclick = async () => { brandApply(await D.brandResetLogo()); toast("Back to the Sothis logo"); };

  /* ---------- Games Sothis recognises (Settings → Gaming) ---------- */
  async function gdRender() {
    const box = $("gdList"); if (!box) return;
    let rows = []; try { rows = await D.gamesSeen(); } catch {}
    box.replaceChildren();
    if (!rows.length) { box.append(mk("div", "gd-empty", "Nothing to show yet. Programs you bring to the front show up here.")); return; }
    const HOW = { yours: "marked by you", "built-in": "built in", library: "from your library", list: "from the game list", folder: "from its folder" };
    for (const r of rows) {
      const row = mk("div", "gd-row" + (r.game ? " on" : "")), tx = mk("div", "gd-tx");
      tx.append(mk("b", "", r.name || r.exe), mk("span", "", r.exe + (r.game ? " · game, " + (HOW[r.how] || "recognised") : r.blocked ? " · marked not a game" : " · not recognised")));
      const yes = mk("button", "btn ghost", r.game ? "Rename" : "It's a game"); yes.type = "button";
      yes.onclick = async () => {
        let name = r.name;
        if (r.game) { name = await askText("Game name", r.name); if (name == null) return; }
        await D.gamesMark({ exe: r.exe, game: true, name }); toast((name || r.exe) + " counts as a game now"); gdRender();
      };
      const no = mk("button", "btn ghost", r.game ? "Not a game" : r.blocked ? "Forget" : ""); no.type = "button"; no.hidden = !r.game && !r.blocked;
      no.onclick = async () => { await D.gamesMark({ exe: r.exe, game: r.game ? false : null }); toast(r.game ? r.exe + " won't count as a game" : "Forgotten"); gdRender(); };
      row.append(tx, yes, no); box.append(row);
    }
  }
  // a small text question without leaving the page (falls back to keeping the current name)
  function askText(label, value) {
    return new Promise(res => {
      const wrap = mk("div", "gd-ask"), inp = mk("input"), ok = mk("button", "btn", "Save"), no = mk("button", "btn ghost", "Cancel");
      inp.type = "text"; inp.value = value || ""; inp.maxLength = 60; inp.setAttribute("aria-label", label); ok.type = no.type = "button";
      const done = v => { wrap.remove(); res(v); };
      ok.onclick = () => done(inp.value.trim() || value); no.onclick = () => done(null);
      inp.onkeydown = e => { if (e.key === "Enter") ok.click(); else if (e.key === "Escape") no.click(); e.stopPropagation(); };
      wrap.append(mk("span", "", label), inp, ok, no); $("gdList").prepend(wrap); inp.focus(); inp.select();
    });
  }
  try { $("gdRefresh").onclick = gdRender; $("setBtn").addEventListener("click", () => setTimeout(gdRender, 200)); } catch {}

  /* ---------- Phone remote (Settings → Phone) ---------- */
  let phInfo = null;
  function phRender() {
    const i = phInfo; if (!i) return;
    $("setPhone").setAttribute("aria-checked", !!i.on);
    $("phSetup").hidden = !i.on;
    const ip = (i.addrs || [])[0], url = ip ? "http://" + ip + ":" + i.port : "";
    $("phUrl").textContent = url || "(no Wi-Fi or network found)";
    $("phCode").textContent = i.code.replace(/(\d{3})(\d{3})/, "$1 $2");
    $("phWarn").textContent = !ip ? "Sothis can't see a home network on this PC." : !i.running ? "The phone remote couldn't start. Something else may be using port " + i.port + "." :
      "If your phone can't open it, allow Sothis through Windows Firewall on private networks (Windows asks the first time).";
    const qr = $("phQr"); qr.replaceChildren();
    if (url && window.qrcode) { try { const q = qrcode(0, "M"); q.addData(url); q.make(); qr.innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); } catch {} }
    const list = $("phList"); list.replaceChildren();
    (i.phones || []).forEach(p => {
      const r = mk("div", "ph-row"), t = mk("span"); t.append(mk("b", "", p.name), document.createTextNode("paired " + new Date(p.at).toLocaleDateString([], { month: "short", day: "numeric" })));
      const x = mk("button", "linkbtn", "Remove"); x.type = "button"; x.onclick = async () => { phInfo = await D.phoneForget(p.id); phRender(); };
      r.append(t, x); list.append(r);
    });
  }
  D.phoneGet().then(i => { phInfo = i; phRender(); }).catch(() => {});


  /* ---------- Releases: new anime and upcoming games, grouped by day, month or year ---------- */
  let relData = null, relBusy = false, relKind = store.get("rel.kind") || "all", relBy = store.get("rel.by") || "day";
  const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function relSeg() {
    document.querySelectorAll("#relKind button").forEach(b => b.setAttribute("aria-checked", b.dataset.k === relKind));
    document.querySelectorAll("#relBy button").forEach(b => b.setAttribute("aria-checked", b.dataset.b === relBy));
  }
  document.querySelectorAll("#relKind button").forEach(b => b.onclick = () => { relKind = b.dataset.k; store.set("rel.kind", relKind); relSeg(); relRender(); });
  document.querySelectorAll("#relBy button").forEach(b => b.onclick = () => { relBy = b.dataset.b; store.set("rel.by", relBy); relSeg(); relRender(); });
  async function relLoad(force) {
    relSeg();
    if (relBusy) return;
    if (relData && !force) return relRender();
    relBusy = true; $("gmRef").classList.add("spin"); if (!relData) $("relMsg").textContent = "Loading releases…";
    try { relData = await D.releasesGet(!!force); } catch { relData = null; }
    relBusy = false; $("gmRef").classList.remove("spin");
    relRender();
  }
  // where an item sorts, and which group it falls in for the chosen grouping
  const relSortKey = d => d.tba ? 99999999 : d.y * 10000 + (d.m || (d.q ? d.q * 3 : 12)) * 100 + (d.d || 99);
  function relGroup(d) {
    if (d.tba) return { k: "z", t: "No date yet" };
    if (relBy === "year") return { k: "y" + d.y, t: String(d.y) };
    if (relBy === "month" || !d.d) {
      if (d.m) return { k: "m" + d.y + "-" + String(d.m).padStart(2, "0") + (relBy === "day" ? "~" : ""), t: MON[d.m - 1] + " " + d.y + (relBy === "day" ? " · day not set yet" : "") };
      if (d.q) return { k: "q" + d.y + d.q, t: "Q" + d.q + " " + d.y };
      return { k: "y" + d.y + "~", t: d.y + " · month not set yet" };
    }
    const dt = new Date(d.y, d.m - 1, d.d), today = new Date(); today.setHours(0, 0, 0, 0);
    const diff = Math.round((dt - today) / 86400000);
    const nice = dt.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: dt.getFullYear() !== today.getFullYear() ? "numeric" : undefined });
    return { k: "d" + d.y + String(d.m).padStart(2, "0") + String(d.d).padStart(2, "0"), t: diff === 0 ? "Today · " + nice : diff === 1 ? "Tomorrow · " + nice : nice };
  }
  function relWhen(it) {
    const d = it.date;
    if (d.tba) return d.text || "No date yet";
    if (d.d) return new Date(d.y, d.m - 1, d.d).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
    if (d.m) return MON[d.m - 1] + " " + d.y;
    if (d.q) return "Q" + d.q + " " + d.y;
    return String(d.y);
  }
  function relRender() {
    if (gmMode !== "rel") return;
    const list = $("relList");
    if (!relData) { list.replaceChildren(); $("relMsg").hidden = false; $("relMsg").textContent = relBusy ? "Loading releases…" : "Couldn't load releases. Check your internet and press refresh."; return; }
    const now = new Date(), ty = now.getFullYear(), tm = now.getMonth() + 1, td = now.getDate(), q = $("gmQ").value.trim().toLowerCase();
    const upcoming = d => d.tba || d.y > ty || (d.y === ty && (!d.m || d.m > tm || (d.m === tm && (!d.d || d.d >= td))));
    const items = relData.items.filter(it => (relKind === "all" || it.kind === relKind) && upcoming(it.date) && (!q || it.title.toLowerCase().includes(q)))
      .sort((a, b) => relSortKey(a.date) - relSortKey(b.date) || (b.pop || 0) - (a.pop || 0));
    const missing = [relData.animeOk ? "" : "anime", relData.gamesOk ? "" : "games"].filter(Boolean);
    $("relMsg").hidden = !!items.length && !missing.length;
    $("relMsg").textContent = !items.length ? "Nothing coming up that matches." : "Couldn't load " + missing.join(" or ") + " right now.";
    const groups = new Map();
    for (const it of items.slice(0, 600)) { const g = relGroup(it.date); if (!groups.has(g.k)) groups.set(g.k, { t: g.t, items: [] }); groups.get(g.k).items.push(it); }
    const out = [];
    for (const [, g] of [...groups.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1)) {
      const h = mk("div", "rel-h"); h.append(mk("b", "", g.t), mk("span", "", g.items.length + (g.items.length === 1 ? " release" : " releases"))); out.push(h);
      for (const it of g.items) {
        const b = mk("button", "rel-it"); b.type = "button"; b.title = "Open " + it.title;
        const art = mk("div", "rel-art"); if (it.img) { const im = mk("img"); im.loading = "lazy"; im.decoding = "async"; im.alt = ""; im.referrerPolicy = "no-referrer"; im.src = it.img; im.onerror = () => im.remove(); art.append(im); }
        const tx = mk("div", "rel-tx"); tx.append(mk("b", "", it.title), mk("span", "", [relWhen(it), it.sub].filter(Boolean).join(" · ")));
        b.append(art, tx, mk("span", "rel-tag " + it.kind, it.kind === "anime" ? "Anime" : "Game"));
        b.onclick = () => { if (!it.url) return; showTab("web"); wbNewTab(it.url); $("wbRelBack").hidden = false; };   // opens in Sothis's own browser, with a way back
        out.push(b);
      }
    }
    list.replaceChildren(...out);
  }

  $("wbRelBack").onclick = () => { $("wbRelBack").hidden = true; gmMode = "rel"; store.set("gm.mode", "rel"); showTab("games"); gmModeShow(); };

  /* ---------- Patch notes: hover the bell to see what changed in Sothis ---------- */
  { const pop = mk("div", "pn-pop"); pop.setAttribute("role", "tooltip"); document.body.append(pop);
    let notes = null, hideT = null, cur = null;
    const fill = async () => {
      if (!notes) { try { notes = await D.changelog(); } catch { notes = []; } }
      const h = mk("h3", "", "What's new in Sothis"); pop.replaceChildren(h);
      const mine = (await D.updGet().catch(() => null)) || {};
      notes.slice(0, 8).forEach((n, i) => {
        const v = mk("div", "pn-v"), t = mk("b", "", n.v);
        if (n.d) { const d = new Date(n.d + "T12:00:00"); t.append(mk("i", "", d.toLocaleDateString([], { month: "short", day: "numeric" }))); }
        if (mine.ver === n.v) t.append(mk("em", "", "you have this"));
        const ul = mk("ul"); (n.notes || []).forEach(x => ul.append(mk("li", "", x)));
        v.append(t, ul); pop.append(v);
      });
      if (!notes.length) pop.append(mk("p", "hint", "No patch notes yet."));
    };
    const place = btn => {
      const r = btn.getBoundingClientRect(), w = pop.offsetWidth || 300, h = pop.offsetHeight || 200;
      const left = Math.max(12, Math.min(innerWidth - w - 12, r.right - w));
      const below = r.bottom + 8 + h < innerHeight - 8;
      pop.style.left = left + "px"; pop.style.top = (below ? r.bottom + 8 : Math.max(8, r.top - h - 8)) + "px";
    };
    const show = async btn => { clearTimeout(hideT); cur = btn; await fill(); if (cur !== btn) return; place(btn); pop.classList.add("on"); };
    const hide = () => { clearTimeout(hideT); hideT = setTimeout(() => { pop.classList.remove("on"); cur = null; }, 220); };
    document.addEventListener("mouseover", e => { const b = e.target.closest && e.target.closest(".bell-btn"); if (b && b !== cur && !bellOpen) show(b); });
    document.addEventListener("mouseout", e => { const b = e.target.closest && e.target.closest(".bell-btn"); if (b && !(e.relatedTarget && (b.contains(e.relatedTarget) || pop.contains(e.relatedTarget)))) hide(); });
    pop.addEventListener("mouseenter", () => clearTimeout(hideT));
    pop.addEventListener("mouseleave", hide);
    document.addEventListener("click", e => { if (e.target.closest && e.target.closest(".bell-btn")) { pop.classList.remove("on"); cur = null; } }, true);
  }

  /* ---------- Tab icons react: Music bounces to the beat, Games shows a dot while a game is open ---------- */
  { const mus = $("tabbtn-ytm"), gm = $("tabbtn-games");
    let sn = null;
    const gmPaint = () => {
      gm.classList.toggle("running", !!sn);
      if (sn) { const m = Math.max(0, Math.round((Date.now() - sn.start) / 60000)); gm.title = "Games · playing " + sn.game + " for " + (m >= 60 ? Math.floor(m / 60) + "h " + String(m % 60).padStart(2, "0") + "m" : m + "m"); }
      else gm.removeAttribute("title");
    };
    const gmPoll = () => D.sessionNow().then(n => { sn = n; gmPaint(); }).catch(() => {});
    gmPoll(); setInterval(gmPoll, 15000);
    try { D.onSession((k, d) => { if (k === "start" && d) sn = { game: d.game, start: d.start }; else if (k === "stop" || k === "end") sn = null; gmPaint(); }); } catch {}
    setInterval(() => {
      const playing = !!(ytState && ytState.playing);
      mus.classList.toggle("beat", playing);
      mus.classList.toggle("live", playing && vizLive);
      if (playing && vizLive) mus.style.setProperty("--tb", Math.min(1, vizBass * 1.3).toFixed(3));
    }, 50);
  }

  /* ---------- Daily start screen: first open of the day ---------- */
  { const sw = $("setDaily");
    let dsOn = store.get("ds.on") !== "0";
    sw.setAttribute("aria-checked", String(dsOn));
    sw.onclick = () => { dsOn = !dsOn; store.set("ds.on", dsOn ? "1" : "0"); sw.setAttribute("aria-checked", String(dsOn)); };
    const esc = t => String(t || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const hm = s => { s = Math.round((s || 0) / 60); return s >= 60 ? Math.floor(s / 60) + "h " + String(s % 60).padStart(2, "0") + "m" : s + "m"; };
    let ov = null;
    const close = () => { if (!ov) return; ov.classList.remove("on"); const o = ov; ov = null; setTimeout(() => o.remove(), 500); };
    async function dsShow() {
      if (ov) return;
      ov = mk("div", "ds"); ov.setAttribute("role", "dialog"); ov.setAttribute("aria-label", "Today");
      const now = new Date(), h = now.getHours();
      const hello = h < 5 ? "Up late" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
      ov.innerHTML = '<div><div class="ds-k">' + esc(now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })) + '</div><div class="ds-hi">' + hello + '</div></div>' +
        '<div class="ds-card ds-wx" id="dsWx"><div><div>Loading the weather…</div></div></div>' +
        '<div class="ds-card"><h3>Out today <span id="dsRelN"></span></h3><div id="dsRel"><div class="ds-none">Loading…</div></div></div>' +
        '<div class="ds-card"><h3>Yesterday</h3><div class="ds-yd" id="dsYd"></div></div>' +
        '<div class="ds-sp"></div><button class="ds-go" type="button" id="dsGo">Let\'s go</button><div class="ds-foot">Shows once a day · turn off in Settings → Window</div>';
      document.body.append(ov);
      requestAnimationFrame(() => requestAnimationFrame(() => ov && ov.classList.add("on")));
      ov.querySelector("#dsGo").onclick = close;
      const keyClose = e => { if (e.key === "Escape") { close(); window.removeEventListener("keydown", keyClose); } };
      window.addEventListener("keydown", keyClose);
      const me = ov;
      // weather (uses the city picked for the weather chip)
      (async () => {
        const box = me.querySelector("#dsWx");
        if (!wxCfg.loc) { box.innerHTML = "<div><div>Pick your city in the weather chip to see the weather here.</div></div>"; return; }
        let d = null; try { d = await D.wxGet(false); } catch {}
        if (!d || !d.now) { box.innerHTML = "<div><div>Couldn't get the weather right now.</div></div>"; return; }
        const t = d.days && d.days[0], deg = v => Math.round(v) + "°";
        box.innerHTML = wxSvg(d.now.code, d.now.day) + '<div><b>' + deg(d.now.t) + '</b><div>' + esc([WX_TXT[d.now.code] || "", t ? "high " + deg(t.hi) + ", low " + deg(t.lo) : "", t && t.rain >= 30 ? t.rain + "% chance of rain" : ""].filter(Boolean).join(" · ")) + (wxCfg.loc.name ? " · " + esc(wxCfg.loc.name) : "") + '</div></div>';
      })();
      // releases out today
      (async () => {
        let r = null; try { r = relData || await D.releasesGet(false); } catch {}
        const box = me.querySelector("#dsRel");
        if (!r || !r.items) { box.innerHTML = '<div class="ds-none">Couldn\'t load releases.</div>'; return; }
        const y = now.getFullYear(), m = now.getMonth() + 1, dd = now.getDate();
        const items = r.items.filter(it => it.date && it.date.y === y && it.date.m === m && it.date.d === dd);
        me.querySelector("#dsRelN").textContent = items.length ? items.length + (items.length === 1 ? " release" : " releases") : "";
        if (!items.length) { box.innerHTML = '<div class="ds-none">Nothing new out today.</div>'; return; }
        box.replaceChildren(...items.slice(0, 5).map(it => {
          const row = mk("div", "ds-rel"); row.setAttribute("role", "button"); row.tabIndex = 0; row.title = it.title;
          if (it.img) { const im = mk("img"); im.src = it.img; im.alt = ""; im.onerror = () => im.replaceWith(mk("span", "ph")); row.append(im); } else row.append(mk("span", "ph"));
          row.append(mk("b", "", it.title), mk("em", it.kind === "anime" ? "an" : "", it.kind === "anime" ? "Anime" : "Game"));
          row.onclick = () => { if (!it.url) return; close(); showTab("web"); wbNewTab(it.url); $("wbRelBack").hidden = false; };
          return row;
        }));
      })();
      // yesterday's totals
      (async () => {
        let y = null; try { y = await D.dayYesterday(); } catch {}
        const box = me.querySelector("#dsYd");
        if (!y) { box.innerHTML = '<div class="ds-none">No data yet.</div>'; return; }
        box.innerHTML = '<div><b>' + hm(y.game) + '</b><span>' + esc(y.topGame ? "gaming · " + y.topGame : "gaming") + '</span></div>' +
          '<div><b>' + (y.plays || 0) + '</b><span>' + esc(y.topArtist ? "songs · " + y.topArtist : "songs") + '</span></div>' +
          '<div><b>' + (y.clips || 0) + '</b><span>clips saved</span></div>';
      })();
    }
    const dsMaybe = () => {
      if (!dsOn || ov || document.hidden || document.body.classList.contains("splashing") || document.body.classList.contains("is-mini") || document.body.classList.contains("is-compact")) return;
      const key = new Date().toDateString();
      if (store.get("ds.day") === key) return;
      store.set("ds.day", key); dsShow();
    };
    setInterval(dsMaybe, 3000);                         // after the splash, and again when a new day starts while Sothis stays open
    document.addEventListener("visibilitychange", () => setTimeout(dsMaybe, 400));
    window.__dsShow = dsShow;                           // for trying it out from the console
  }

  /* ---------- Your week ---------- */
  let wkOff = 0;
  const wkH = s => { s = Math.round(s / 60); return s >= 60 ? Math.floor(s / 60) + "h " + String(s % 60).padStart(2, "0") + "m" : s + "m"; };
  const wkDelta = (a, b, isTime) => { if (!b) return ""; const d = a - b; if (Math.abs(d) < (isTime ? 300 : 1)) return '<i class="wk-down">same as last week</i>'; return '<i class="' + (d > 0 ? "wk-up" : "wk-down") + '">' + (d > 0 ? "▲ " : "▼ ") + (isTime ? wkH(Math.abs(d)) : Math.abs(d)) + " vs last week</i>"; };
  const wkEsc = t => String(t || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  async function wkShow() {
    let r; try { r = await D.weekGet(wkOff); } catch { return; }
    const a = new Date(r.start), b = new Date(r.start + 6 * 86400000);
    const f = d => d.toLocaleDateString([], { month: "short", day: "numeric" });
    $("wkTitle").textContent = wkOff === 0 ? "This week" : wkOff === 1 ? "Last week" : "Week of " + f(a);
    $("wkRange").textContent = f(a) + " – " + f(b);
    $("wkNext").disabled = wkOff === 0;
    $("wkPrev").disabled = !r.since || new Date(r.since + "T00:00:00").getTime() >= r.start;
    if (!r.hasAny) { $("wkBody").innerHTML = '<p class="wk-empty">Sothis starts keeping track now: the music you play and the games you\'re in. Check back in a few days for your first recap (it pings you Sunday evening).</p>'; return; }
    const max = Math.max(1, ...r.days.map(d => d.music + d.game));
    const cols = r.days.map((d, ci) => {
      const dt = new Date(d.day + "T12:00:00");
      return '<div class="wk-col' + (d.day === r.busiest ? " top" : "") + '" title="' + dt.toLocaleDateString([], { weekday: "long" }) + ": " + wkH(d.music) + " music, " + wkH(d.game) + ' games">'
        + '<i class="g" style="height:' + (d.game / max * 100) + '%;animation-delay:' + (ci * 90) + 'ms"></i><i class="m" style="height:' + (d.music / max * 100) + '%;animation-delay:' + (ci * 90 + 40) + 'ms"></i>'
        + '<span>' + dt.toLocaleDateString([], { weekday: "short" }) + '</span></div>';
    }).join("");
    const rank = (list, row) => list.length ? '<ol class="wk-rank">' + list.map((x, i) => '<li><em>' + (i + 1) + '</em>' + row(x) + '</li>').join("") + '</ol>' : '<p class="wk-empty">Nothing yet.</p>';
    $("wkBody").innerHTML =
      '<div class="wk-big">'
      + '<div><b data-sec="' + r.music + '">' + wkH(r.music) + '</b><span>music · ' + r.plays + ' songs</span><br>' + wkDelta(r.music, r.musicPrev, true) + '</div>'
      + '<div><b data-sec="' + r.game + '">' + wkH(r.game) + '</b><span>gaming</span><br>' + wkDelta(r.game, r.gamePrev, true) + '</div>'
      + '<div><b data-n="' + r.clips + '">' + r.clips + '</b><span>clips saved</span><br>' + wkDelta(r.clips, r.clipsPrev, false) + '</div>'
      + '</div>'
      + '<h3>Day by day</h3><div class="wk-chart">' + cols + '</div>'
      + '<div class="wk-key"><span><i style="background:var(--accent)"></i>Music</span><span><i style="background:#5b8cff"></i>Games</span>' + (r.busiest ? '<span>Busiest: ' + new Date(r.busiest + "T12:00:00").toLocaleDateString([], { weekday: "long" }) + '</span>' : '') + '</div>'
      + '<div class="wk-two"><div><h3>Top songs</h3>' + rank(r.songs, x => '<b>' + wkEsc(x.title) + '<small>' + wkEsc(x.artist) + '</small></b><span>' + wkH(x.secs) + '</span>') + '</div>'
      + '<div><h3>Top artists</h3>' + rank(r.artists, x => '<b>' + wkEsc(x.name) + '</b><span>' + wkH(x.secs) + '</span>') + '</div></div>'
      + '<h3>Games</h3>' + rank(r.games, x => '<b>' + wkEsc(x.name) + '</b><span>' + wkH(x.secs) + '</span>')
      + (r.calls || r.callsPrev ? '<h3>Discord calls</h3><div class="wk-big wk-calls"><div><b data-sec="' + (r.calls || 0) + '">' + wkH(r.calls || 0) + '</b><span>in calls' + (r.callCount ? ' · ' + r.callCount + (r.callCount === 1 ? ' call' : ' calls') : '') + '</span><br>' + wkDelta(r.calls || 0, r.callsPrev, true) + '</div></div>'
        + (r.people && r.people.length ? '<h3>Most time with</h3>' + rank(r.people, x => '<b>' + wkEsc(x.name) + '</b><span>' + wkH(x.secs) + '</span>') : '') : '');
    wkCount();
  }
  // the totals count up from zero when the recap opens
  function wkCount() {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    $("wkBody").querySelectorAll(".wk-big b[data-sec], .wk-big b[data-n]").forEach(b => {
      const sec = b.dataset.sec != null, to = +(sec ? b.dataset.sec : b.dataset.n), t0 = performance.now(), dur = 1200;
      const step = now => { const p = Math.min(1, (now - t0) / dur), v = to * (1 - Math.pow(1 - p, 3)); b.textContent = sec ? wkH(v) : String(Math.round(v)); if (p < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
  }
  function wkOpen() { wkOff = 0; $("wkOv").hidden = false; wkShow(); }
  $("hmWeek").onclick = wkOpen;
  D.onWeekOpen(wkOpen);
  $("wkClose").onclick = () => { $("wkOv").hidden = true; };
  $("wkPrev").onclick = () => { wkOff++; wkShow(); };
  $("wkNext").onclick = () => { if (wkOff > 0) { wkOff--; wkShow(); } };

  /* ---------- Phone files ---------- */
  let fxI = null;
  const fxSize = n => n >= 1073741824 ? (n / 1073741824).toFixed(1) + " GB" : n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
  const fxAgo = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : new Date(t).toLocaleDateString([], { month: "short", day: "numeric" }); };
  function fxRender() {
    const i = fxI; if (!i) return;
    const mkRow = (name, meta, btns) => { const r = mk("div", "fx-row"); const b = mk("b", "", name); b.title = name; r.append(b, mk("span", "", meta)); const w = mk("span", ""); for (const x of btns) w.append(x); r.append(w); return r; };
    $("fxOut").replaceChildren(...i.out.slice().reverse().map(o => { const x = mk("button", "linkbtn", "Remove"); x.type = "button"; x.onclick = async () => { fxI = await D.shareRemove(o.id); fxRender(); }; return mkRow(o.name, fxSize(o.size), [x]); }));
    if (!i.out.length) $("fxOut").replaceChildren(mk("p", "wk-empty", "Nothing waiting for your phone."));
    $("fxGot").replaceChildren(...i.got.map(g => { const x = mk("button", "linkbtn", "Show"); x.type = "button"; x.onclick = () => D.shareShow(g.path); return mkRow(g.name, fxSize(g.size) + " · " + fxAgo(g.at), [x]); }));
    if (!i.got.length) $("fxGot").replaceChildren(mk("p", "wk-empty", "Open Sothis on your phone and tap Send to PC. Files land in your Downloads, in a folder called From phone."));
    const ph = typeof phInfo !== "undefined" ? phInfo : null;
    $("fxWarn").hidden = !!(ph && ph.on && ph.phones && ph.phones.length);
    $("fxWarn").textContent = "Pair your phone first: Settings → Phone.";
  }
  D.shareGet().then(i => { fxI = i; fxRender(); }).catch(() => {});
  D.onShare(i => { fxI = i; if (!$("fxOv").hidden) fxRender(); });
  $("hmFiles").onclick = async () => { try { fxI = await D.shareGet(); } catch {} $("fxOv").hidden = false; fxRender(); };
  $("fxClose").onclick = () => { $("fxOv").hidden = true; };
  $("fxFolder").onclick = () => D.shareShow("");
  $("fxDrop").onclick = () => $("fxPick").click();
  $("fxDrop").onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("fxPick").click(); } };
  $("fxPick").onchange = async () => { const fl = $("fxPick").files; if (fl && fl.length) { fxI = await D.shareAddFiles(fl); fxRender(); toast(fl.length === 1 ? "Ready on your phone" : fl.length + " files ready on your phone"); } $("fxPick").value = ""; };
  { const z = $("fxDrop");
    z.addEventListener("dragover", e => { e.preventDefault(); e.stopPropagation(); z.classList.add("over"); });
    z.addEventListener("dragleave", () => z.classList.remove("over"));
    z.addEventListener("drop", async e => { e.preventDefault(); e.stopPropagation(); z.classList.remove("over"); const fl = e.dataTransfer && e.dataTransfer.files; if (fl && fl.length) { fxI = await D.shareAddFiles(fl); fxRender(); toast(fl.length === 1 ? "Ready on your phone" : fl.length + " files ready on your phone"); } }); }
  for (const id of ["wkOv", "fxOv"]) $(id).addEventListener("mousedown", e => { if (e.target.id === id) $(id).hidden = true; });
  document.addEventListener("keydown", e => { if (e.key === "Escape") { $("wkOv").hidden = true; $("fxOv").hidden = true; } });
  /* ---------- Lighting (ASUS Aura through Sothis) ---------- */
  if (D.has && D.has.sw === false) { const b = $("tabbtn-switch"); if (b) b.remove(); }
  // only on PCs that have the lighting helper / the chime
  if (D.has && D.has.rgb === false) { const g = $("rgbGroup"); if (g) { const hold = document.createElement("div"); hold.hidden = true; document.body.append(hold); hold.append(g); } }   // out of Settings (and its section buttons)
  if (D.has && D.has.chime === false) { const qd = $("setQp") && $("setQp").parentElement.querySelector(".desc"); if (qd) qd.textContent = "When your game finds a match while you're tabbed out, Sothis shows a banner with a button that takes you back to the game."; }
  const RGB_SW = ["ff0000", "ff5a00", "ffc400", "00ff40", "00e5ff", "0050ff", "8a2be2", "ff00b4", "ffffff"];
  let rgbI = null, rgbDragB = false;
  { const w = $("rgbSw");
    for (const c of RGB_SW) { const b = document.createElement("button"); b.type = "button"; b.dataset.c = c; b.style.background = "#" + c; b.setAttribute("aria-label", "#" + c); b.onclick = () => rgbPut({ color: c }); w.append(b); }
    const pick = document.createElement("input"); pick.type = "color"; pick.id = "rgbPick"; pick.setAttribute("aria-label", "Any color"); w.append(pick);
    let pT = null; pick.addEventListener("input", () => { clearTimeout(pT); pT = setTimeout(() => rgbPut({ color: pick.value }), 80); }); }
  function rgbRender() {
    const i = rgbI; if (!i) return;
    $("setRgb").setAttribute("aria-checked", String(!!i.on));
    $("setRgbFlash").setAttribute("aria-checked", String(!!i.flashMatch));
    $("setRgbWd").setAttribute("aria-checked", String(!!i.wdTeam));
    $("rgbWdDesc").textContent = i.team ? "Showing " + i.team.name + " right now. Your own color comes back when you leave Wardogs." : "In Wardogs your lights turn your team's color: blue for Lonestar, red for Valkyra, green for Manticore. Back to your own color when you leave.";
    $("rgbMode").value = i.mode;
    for (const b of $("rgbSw").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.c === i.color));
    $("rgbPick").value = "#" + i.color;
    if (!rgbDragB) { $("rgbBri").value = i.bri; $("rgbBriV").textContent = i.bri + "%"; }
    $("rgbSpeed").value = i.speed; $("rgbSpeedV").textContent = i.speed;
    $("rgbSpeedRow").hidden = !(i.mode === "breathe" || i.mode === "cycle");
    const base = "Takes over your ASUS Aura lights (motherboard, RAM, LED strip) from Armoury Crate. Turn it off to hand them back.";
    $("rgbDesc").textContent = !i.on ? base : i.status === "ready" ? "Sothis is running your lights" + (i.devices ? " (" + i.devices.split(",").length + " devices)" : "") + ". Turn it off to hand them back to Armoury Crate."
      : i.status === "error" ? (i.err || "Couldn't reach your lights.") : "Connecting to your lights…";
  }
  async function rgbPut(p) { try { rgbI = await D.rgbSet(p); rgbRender(); } catch {} }
  D.rgbGet().then(i => { rgbI = i; rgbRender(); }).catch(() => {});
  D.onRgb(i => { rgbI = i; rgbRender(); });
  $("setRgb").onclick = () => rgbPut({ on: !(rgbI && rgbI.on) });
  $("setRgbWd").onclick = () => rgbPut({ wdTeam: !(rgbI && rgbI.wdTeam) });
  $("setRgbFlash").onclick = () => rgbPut({ flashMatch: !(rgbI && rgbI.flashMatch) });
  $("rgbMode").onchange = () => rgbPut({ mode: $("rgbMode").value });
  { let t = null; $("rgbBri").addEventListener("input", () => { rgbDragB = true; $("rgbBriV").textContent = $("rgbBri").value + "%"; clearTimeout(t); t = setTimeout(async () => { await rgbPut({ bri: +$("rgbBri").value }); rgbDragB = false; }, 120); }); }
  $("rgbSpeed").addEventListener("change", () => rgbPut({ speed: +$("rgbSpeed").value }));
  $("rgbSpeed").addEventListener("input", () => { $("rgbSpeedV").textContent = $("rgbSpeed").value; });
  $("rgbTest").onclick = () => D.rgbTest();

  /* ---------- Updates (Settings → Updates) ---------- */
  let updInfo = null;
  function updRender() {
    const u = updInfo; if (!u) return;
    $("updVer").textContent = "v" + u.ver;
    const ago = u.at ? " Checked " + new Date(u.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) + "." : "";
    $("updDesc").textContent = { norepo: "Updates aren't set up for this copy.", idle: "Not checked yet.", checking: "Checking for a new version…", current: "You're up to date." + ago,
      downloading: "Downloading v" + u.latest + "…", installing: "Installing v" + u.latest + "…", ready: "v" + u.latest + " is ready. Restart Sothis to finish.", error: "Couldn't update: " + (u.err || "unknown problem") }[u.state] || "";
    $("updBtn").textContent = u.state === "ready" ? "Restart" : "Check now";
    $("updBtn").disabled = ["checking", "downloading", "installing"].includes(u.state) || u.state === "norepo";
    if ("auto" in u) $("setUpdAuto").setAttribute("aria-checked", !!u.auto);
  }
  D.updGet().then(u => { updInfo = u; updRender(); }).catch(() => {});
  D.onUpd(u => { updInfo = Object.assign({}, updInfo, u); updRender(); });
  $("updBtn").onclick = async () => { if (updInfo && updInfo.state === "ready") return D.restartApp(); updInfo = Object.assign({}, updInfo, await D.updCheck()); updRender(); };
  $("setUpdAuto").onclick = async () => { const v = await D.updAuto(!(updInfo && updInfo.auto !== false)); updInfo = Object.assign({}, updInfo, { auto: v }); updRender(); };
  D.onPhone((kind, i) => { if (kind === "info") { phInfo = i; phRender(); } else if (kind === "paired") { toast((i && i.name || "Your phone") + " is paired"); D.phoneGet().then(x => { phInfo = x; phRender(); }); } });
  $("setPhone").onclick = async () => { phInfo = await D.phoneSet(!(phInfo && phInfo.on)); phRender(); };
  $("phNew").onclick = async () => { phInfo = await D.phoneNewCode(); phRender(); };
  document.addEventListener("visibilitychange", () => { if (!document.hidden && wxData && wxData.at && Date.now() - wxData.at > 15 * 60 * 1000) wxLoad(); });

  /* ---------- Daily reminder: claim Overwatch skins ---------- */
  const today = () => new Date().toLocaleDateString("en-CA");
  let rmdNudged = "";
  function renderRmd() {
    // only on your own PC (turned on in Roaming\Sothis\personal.json), never in the copy friends get
    if (!(D.personal && D.personal.owReminder)) { $("rmdOw").hidden = true; return; }
    const due = store.get("rmd.ow") !== today();
    $("rmdOw").hidden = !due;
    // one in-app nudge per day, the first time Sothis is on screen
    if (due && !document.hidden && rmdNudged !== today() && !document.body.classList.contains("splashing")) {
      rmdNudged = today();
      note("reminder", "Daily reminder", "Claim your Overwatch skins today.");
      const stack = $("dcnStack"), c = mk("div", "dcn"), ic = mk("span", "glogo");
      ic.dataset.logo = "ow"; ic.style.cssText = "width:28px;height:28px;color:#ff9c28;flex:none";
      const tx = mk("div"); tx.append(mk("b", "", "Daily reminder"), mk("span", "", "Claim your Overwatch skins today."));
      c.append(ic, tx);
      const bye = () => { c.classList.add("out"); setTimeout(() => c.remove(), 260); };
      c.onclick = () => { bye(); showTab("home"); };
      stack.prepend(c); setTimeout(bye, 9000);
    }
  }
  $("rmdDone").onclick = () => { store.set("rmd.ow", today()); renderRmd(); toast("Nice, see you tomorrow"); };
  // View: the Overwatch rewards in Opera GX's gift panel (GX Rewards), where you claim each day's skin
  $("rmdGo").onclick = async () => { const ok = await D.operaUrl("https://gx.me/gx/en-GB/campaigns/overwatch-campaign/"); toast(ok ? "Opening GX Rewards in Opera GX" : "Couldn't open Opera GX"); };
  setInterval(renderRmd, 60000);
  document.addEventListener("visibilitychange", renderRmd);
  setTimeout(renderRmd, 3500);

  /* ---------- Live updates ---------- */
  let updCard = null;
  D.onUpdate(u => {
    const restart = !!u.restart;
    note("update", "Sothis update ready", restart ? "Restart to finish updating" : "Reload to see the changes");
    if (updCard) updCard.remove();
    const c = mk("div", "dcn upd"), ic = mk("img"); ic.src = window.__brandCrest || "crest-bg.png"; ic.alt = ""; ic.style.cssText = "border-radius:0;object-fit:contain;filter:drop-shadow(0 0 6px rgba(255,30,50,.7))";
    const tx = mk("div"); tx.append(mk("b", "", "Sothis update ready"), mk("span", "", restart ? "Restart Sothis to finish updating." : "Reload to see the changes."));
    const btn = mk("button", "btn upd-b", restart ? "Restart" : "Reload"); btn.type = "button";
    btn.onclick = e => { e.stopPropagation(); restart ? D.restartApp() : D.reloadApp(); };
    c.append(ic, tx, btn);
    c.onclick = null;
    $("dcnStack").prepend(c); updCard = c;
  });


