// Blackwall: tabs, address bar, start page, bookmarks, history, downloads. Kept in this window's storage on this PC.
(() => {
  const $ = id => document.getElementById(id);
  const B = window.sb || new Proxy({}, { get: () => () => Promise.resolve(null) });
  const mk = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
  const toast = t => { const el = $("toast"); el.textContent = t; el.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove("on"), Math.max(2000, t.length * 55)); };
  const host = u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
  const favi = u => { const h = host(u); return h ? "https://www.google.com/s2/favicons?sz=64&domain=" + h : ""; };
  const ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  const ICON_SND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>';
  const RELOAD = "M20 12a8 8 0 1 1-2.3-5.7L20 8.5M20 3.5v5h-5", STOP = "M6 6l12 12M18 6 6 18";

  let cfg = { adBlock: true, popBlock: true, search: "google" };
  B.cfg().then(c => { if (c) { cfg = c; paintSettings(); } }).catch(() => {});
  const ENG = { google: "https://www.google.com/search?q=", ddg: "https://duckduckgo.com/?q=", bing: "https://www.bing.com/search?q=", brave: "https://search.brave.com/search?q=" };
  function toUrl(q) {
    q = String(q || "").trim(); if (!q) return "";
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(q) || /^about:/i.test(q)) return q;
    if (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/|$)/i.test(q) || (/^[^\s]+\.[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(q) && !/\s/.test(q))) return "https://" + q;
    return (ENG[cfg.search] || ENG.google) + encodeURIComponent(q);
  }

  /* ---------- tabs ---------- */
  let tabs = [], cur = null, seq = 0;
  const closed = [];
  const now = () => tabs.find(t => t.id === cur);
  function newTab(url, bg) {
    const t = { id: ++seq, url: url || "", title: "", icon: "", loading: false, audible: false, wv: null, blocked: 0, wcId: 0, zoom: 1 };
    tabs.push(t);
    if (t.url) makeView(t);
    if (bg) renderTabs(); else select(t.id);
    save();
    return t;
  }
  function makeView(t) {
    const wv = document.createElement("webview");
    wv.setAttribute("partition", "persist:web");
    wv.setAttribute("allowpopups", "");
    wv.setAttribute("webpreferences", "contextIsolation=yes, backgroundThrottling=yes");
    wv.src = t.url;
    wv.classList.add("off");
    t.wv = wv;
    wv.addEventListener("dom-ready", () => { try { t.wcId = wv.getWebContentsId(); } catch {} try { wv.setZoomFactor(t.zoom); } catch {} }, { once: false });
    wv.addEventListener("did-start-loading", () => { t.loading = true; paint(t); });
    wv.addEventListener("did-stop-loading", () => { t.loading = false; paint(t); });
    wv.addEventListener("did-navigate", e => { t.url = e.url; t.blocked = 0; addHistory(t); paint(t); save(); });
    wv.addEventListener("did-navigate-in-page", e => { if (e.isMainFrame) { t.url = e.url; paint(t); save(); } });
    wv.addEventListener("page-title-updated", e => { t.title = e.title; paint(t); updHistoryTitle(t); });
    wv.addEventListener("page-favicon-updated", e => { t.icon = (e.favicons || [])[0] || ""; paint(t); });
    wv.addEventListener("media-started-playing", () => { t.audible = true; paint(t); });
    wv.addEventListener("media-paused", () => { t.audible = false; paint(t); });
    wv.addEventListener("enter-html-full-screen", () => { document.body.classList.add("full"); B.full(true); });
    wv.addEventListener("leave-html-full-screen", () => { document.body.classList.remove("full"); B.full(false); });
    wv.addEventListener("found-in-page", e => { const r = e.result; if (r && r.finalUpdate) $("findN").textContent = r.matches ? r.activeMatchOrdinal + "/" + r.matches : "0/0"; });
    wv.addEventListener("did-fail-load", e => { if (e.isMainFrame && e.errorCode !== -3) { t.loading = false; paint(t); } });
    wv.addEventListener("did-start-navigation", e => { if (e.isMainFrame && !e.isInPlace) { t.loadPct = 15; prog(); } });
    $("view").append(wv);
  }
  function select(id) {
    const t = tabs.find(x => x.id === id); if (!t) return;
    cur = id;
    tabs.forEach(x => { if (x.wv) x.wv.classList.toggle("off", x.id !== id); });
    if (t.url && !t.wv) makeView(t);
    if (t.wv) t.wv.classList.remove("off");
    $("start").hidden = !!t.url;
    if (!t.url) startRender();
    renderTabs(); paintBar(); save();
    if (!t.url) setTimeout(() => $("sq").focus(), 30);
  }
  function close(id) {
    const i = tabs.findIndex(t => t.id === id); if (i < 0) return;
    const [t] = tabs.splice(i, 1);
    if (t.url) { closed.push(t.url); if (closed.length > 25) closed.shift(); }
    if (t.wv) t.wv.remove();
    if (!tabs.length) { newTab(""); return; }
    if (cur === id) select(tabs[Math.min(i, tabs.length - 1)].id); else { renderTabs(); save(); }
  }
  function go(q) {
    const url = toUrl(q); if (!url) return;
    let t = now(); if (!t) t = newTab("");
    t.url = url; t.title = ""; t.icon = "";
    if (t.wv) t.wv.loadURL(url).catch(() => {}); else makeView(t);
    select(t.id);
    try { t.wv.focus(); } catch {}
  }
  function paint(t) { renderTabs(); if (t.id === cur) paintBar(); }
  function renderTabs() {
    const box = $("tabs"); box.replaceChildren();
    tabs.forEach(t => {
      const b = mk("div", "tab" + (t.id === cur ? " on" : "")); b.setAttribute("role", "tab"); b.title = t.title || t.url || "New tab";
      if (t.loading) b.append(mk("i", "spin"));
      else if (t.icon || t.url) { const im = mk("img"); im.alt = ""; im.src = t.icon || favi(t.url); im.onerror = () => { im.replaceWith(mk("span", "fi", (host(t.url) || "?")[0].toUpperCase())); }; b.append(im); }
      else { const im = mk("img"); im.alt = ""; im.src = "assets/blackwall.png"; b.append(im); }
      b.append(mk("span", "t", t.title || (t.url ? host(t.url) : "New tab")));
      if (t.audible) { const s = mk("span", "snd"); s.innerHTML = ICON_SND; b.append(s); }
      const x = mk("button", "x"); x.type = "button"; x.setAttribute("aria-label", "Close tab"); x.innerHTML = ICON_X;
      x.onclick = e => { e.stopPropagation(); close(t.id); };
      b.onmousedown = e => { if (e.button === 1) { e.preventDefault(); close(t.id); } };
      b.onclick = () => select(t.id);
      b.append(x); box.append(b);
    });
    document.title = (now() && now().title ? now().title + " · " : "") + "Blackwall";
  }
  function paintBar() {
    const t = now(); if (!t) return;
    const wv = t.wv;
    let back = false, fwd = false; try { back = !!(wv && wv.canGoBack()); fwd = !!(wv && wv.canGoForward()); } catch {}
    $("bBack").disabled = !back; $("bFwd").disabled = !fwd;
    $("bReloadI").setAttribute("d", t.loading ? STOP : RELOAD);
    if (document.activeElement !== $("url")) $("url").value = t.url || "";
    const secure = /^https:/.test(t.url);
    $("urlIc").classList.toggle("lock", secure);
    $("urlIc").innerHTML = t.url ? (secure ? '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>' : '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>') : '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>';
    $("urlIc").setAttribute("title", t.url ? (secure ? "Connection is secure" : "This page isn't using a secure connection") : "");
    const bm = bms.some(b => b.u === t.url);
    $("bStar").classList.toggle("on", bm); $("bStarI").setAttribute("fill", bm ? "currentColor" : "none");
    $("bStar").disabled = !t.url;
    $("shieldN").textContent = cfg.adBlock && t.blocked ? (t.blocked > 99 ? "99+" : String(t.blocked)) : "";
    $("bShield").classList.toggle("on", cfg.adBlock);
    $("zoomT").textContent = Math.round((t.zoom || 1) * 100) + "%";
    prog();
  }
  function prog() {
    const t = now(), on = !!(t && t.loading);
    $("prog").classList.toggle("on", on);
    $("progI").style.width = on ? "70%" : "100%";
    if (!on) setTimeout(() => { if (!(now() && now().loading)) $("progI").style.width = "0"; }, 400);
  }
  function save() { store.set("tabs", { list: tabs.filter(t => t.url).map(t => ({ url: t.url, title: t.title })), cur: Math.max(0, tabs.filter(t => t.url).findIndex(t => t.id === cur)) }); }

  /* ---------- bookmarks, shortcuts, history ---------- */
  const QUICK_DEF = [["YouTube", "https://www.youtube.com/"], ["Google", "https://www.google.com/"], ["Reddit", "https://www.reddit.com/"], ["Twitch", "https://www.twitch.tv/"],
    ["Nexus Mods", "https://www.nexusmods.com/"], ["Modrinth", "https://modrinth.com/"], ["PokéBonk", "https://pokebonk.com/"], ["Gmail", "https://mail.google.com/"]].map(([n, u]) => ({ n, u }));
  let quick = store.get("quick", null); if (!Array.isArray(quick)) quick = QUICK_DEF.slice();
  let bms = store.get("bookmarks", []); if (!Array.isArray(bms)) bms = [];
  let hist = store.get("history", []); if (!Array.isArray(hist)) hist = [];
  let bmBar = store.get("bmBar", true);
  function addHistory(t) {
    if (!/^https?:/.test(t.url)) return;
    hist = hist.filter(h => h.u !== t.url); hist.unshift({ u: t.url, t: t.title || host(t.url), at: Date.now() });
    if (hist.length > 1500) hist.length = 1500; store.set("history", hist);
  }
  function updHistoryTitle(t) { const h = hist.find(x => x.u === t.url); if (h && t.title) { h.t = t.title; store.set("history", hist); } }
  function bmToggle() {
    const t = now(); if (!t || !t.url) return;
    const i = bms.findIndex(b => b.u === t.url);
    if (i >= 0) { bms.splice(i, 1); toast("Bookmark removed"); } else { bms.push({ u: t.url, t: t.title || host(t.url) }); toast("Bookmarked"); }
    store.set("bookmarks", bms); bmRender(); paintBar();
  }
  function bmRender() {
    const box = $("bms"); box.replaceChildren(); box.hidden = !bmBar || !bms.length;
    $("bmbarT").textContent = bmBar ? "Hide bookmarks bar" : "Show bookmarks bar";
    bms.forEach((b, i) => {
      const e = mk("button", "bm"); e.type = "button"; e.title = b.u;
      const im = mk("img"); im.alt = ""; im.src = favi(b.u); im.onerror = () => im.remove();
      e.append(im, mk("span", "", b.t || host(b.u)));
      e.onclick = ev => { if (ev.ctrlKey) newTab(b.u, true); else go(b.u); };
      e.onauxclick = ev => { if (ev.button === 1) newTab(b.u, true); };
      e.oncontextmenu = ev => { ev.preventDefault(); bms.splice(i, 1); store.set("bookmarks", bms); bmRender(); paintBar(); toast("Bookmark removed"); };
      box.append(e);
    });
  }
  function startRender() {
    const q = $("quick"); q.replaceChildren();
    quick.forEach((s, i) => {
      const b = mk("button", "q"); b.type = "button"; b.title = s.u;
      const ic = mk("i", "", (s.n || "?")[0].toUpperCase());
      const im = mk("img"); im.alt = ""; im.src = favi(s.u); im.onload = () => { ic.textContent = ""; ic.append(im); };
      const rm = mk("span", "rm", "×"); rm.setAttribute("role", "button"); rm.title = "Remove";
      rm.onclick = e => { e.stopPropagation(); quick.splice(i, 1); store.set("quick", quick); startRender(); };
      b.append(rm, ic, mk("span", "", s.n)); b.onclick = () => go(s.u); q.append(b);
    });
    const add = mk("button", "q qadd"); add.type = "button"; add.append(mk("i", "", "+"), mk("span", "", "Add"));
    add.onclick = () => {
      const last = tabs.map(t => t.url).filter(Boolean).pop() || (hist[0] && hist[0].u) || "";
      const u = toUrl(prompt("Web address for the shortcut", last) || ""); if (!u) return;
      const n = (prompt("Name", host(u).split(".")[0].replace(/^./, c => c.toUpperCase())) || "").trim().slice(0, 20); if (!n) return;
      quick.push({ n, u }); store.set("quick", quick); startRender();
    };
    q.append(add);
    const r = $("recent"); r.replaceChildren();
    const rec = hist.slice(0, 6);
    if (rec.length) { r.append(mk("h3", "", "Recently visited")); rec.forEach(h => r.append(histRow(h))); }
  }
  function histRow(h) {
    const b = mk("button", "row"); b.type = "button"; b.title = h.u;
    const im = mk("img"); im.alt = ""; im.src = favi(h.u); im.onerror = () => im.replaceWith(mk("span", "fi"));
    b.append(im, mk("b", "", h.t || host(h.u)), mk("span", "", host(h.u)));
    b.onclick = () => { closePops(); go(h.u); };
    return b;
  }
  // prompt() isn't available in Electron: a tiny inline one
  function prompt(label, val) { return window.__prompt ? window.__prompt(label, val) : null; }
  window.__prompt = null;

  /* ---------- panels ---------- */
  const POPS = ["menu", "dlPop", "hiPop", "setPop"];
  function closePops(except) { POPS.forEach(p => { if (p !== except) $(p).hidden = true; }); }
  function togglePop(id) { const open = $(id).hidden; closePops(); $(id).hidden = !open; if (open && id === "hiPop") histRender(); if (open && id === "dlPop") { dlSeen = dls.length; dlRender(); } }
  document.addEventListener("mousedown", e => { if (!e.target.closest(".pop") && !e.target.closest("#bMenu, #bDl, #bShield")) closePops(); });
  function histRender() {
    const box = $("hiList"); box.replaceChildren();
    if (!hist.length) { box.append(mk("div", "empty", "Nothing here yet.")); return; }
    let day = "";
    hist.slice(0, 200).forEach(h => {
      const d = new Date(h.at).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
      if (d !== day) { day = d; box.append(mk("div", "empty", d)); }
      box.append(histRow(h));
    });
  }
  $("hiClear").onclick = () => { hist = []; store.set("history", hist); histRender(); toast("History cleared"); };
  // downloads
  let dls = [], dlSeen = 0;
  B.onDl(d => {
    let x = dls.find(y => y.id === d.id); if (!x) { x = d; dls.unshift(x); if (d.state === "progress") toast("Downloading " + d.name); } else Object.assign(x, d);
    if (d.state === "completed") toast("Downloaded " + d.name);
    $("dlN").textContent = dls.filter(y => y.state === "progress").length || (dls.length - dlSeen > 0 ? String(dls.length - dlSeen) : "");
    if (!$("dlPop").hidden) dlRender();
  });
  const fmtB = n => n > 1e9 ? (n / 1e9).toFixed(1) + " GB" : n > 1e6 ? (n / 1e6).toFixed(1) + " MB" : Math.round(n / 1e3) + " KB";
  function dlRender() {
    const box = $("dlList"); box.replaceChildren();
    if (!dls.length) { box.append(mk("div", "empty", "No downloads yet. Files save to your Downloads folder.")); return; }
    dls.forEach(d => {
      const e = mk("div", "dl"); e.append(mk("b", "", d.name));
      if (d.state === "progress") { const pb = mk("div", "pb"), i = mk("i"); i.style.width = (d.total ? d.got / d.total * 100 : 30) + "%"; pb.append(i); e.append(pb, mk("span", "", fmtB(d.got) + (d.total ? " of " + fmtB(d.total) : ""))); }
      else e.append(mk("span", "", d.state === "completed" ? fmtB(d.total || d.got) : d.state === "cancelled" ? "Cancelled" : "Failed"));
      if (d.state === "completed") { const a = mk("div", "acts"), o = mk("button", "", "Open"), s = mk("button", "", "Show in folder"); o.onclick = () => B.dlOpen(d.file); s.onclick = () => B.dlShow(d.file); a.append(o, s); e.append(a); }
      box.append(e);
    });
  }
  $("dlFolder").onclick = () => B.dlFolder();
  // settings
  function paintSettings() {
    $("sAd").setAttribute("aria-checked", cfg.adBlock); $("sPop").setAttribute("aria-checked", cfg.popBlock); $("sEng").value = cfg.search || "google";
    const t = now(); $("adN").textContent = cfg.adBlock ? (t && t.blocked ? t.blocked + " blocked on this tab." : "Stops known ad servers from loading.") : "Ads load normally.";
    paintBar();
  }
  $("sAd").onclick = async () => { cfg = await B.setCfg({ adBlock: !cfg.adBlock }) || cfg; paintSettings(); toast(cfg.adBlock ? "Ad blocking on. Reload to clear ads already shown" : "Ad blocking off"); };
  $("sPop").onclick = async () => { cfg = await B.setCfg({ popBlock: !cfg.popBlock }) || cfg; paintSettings(); };
  $("sEng").onchange = async () => { cfg = await B.setCfg({ search: $("sEng").value }) || cfg; paintSettings(); };
  // default browser: Windows only lets you choose this yourself, so this opens the right page in Settings
  const defPaint = () => B.isDefault().then(on => { $("sDefaultT").textContent = on ? "Blackwall is your default browser" : "Make Blackwall your default browser"; }).catch(() => {});
  $("sDefault").onclick = async () => { await B.defaultOpen(); toast("In Settings, set Blackwall for HTTPS and HTTP (or press Set default)"); setTimeout(defPaint, 8000); };
  defPaint();
  $("sClear").onclick = async () => { $("sClear").disabled = true; await B.clearData(); $("sClear").disabled = false; toast("Cookies and site data cleared"); };
  B.onBlocked(d => { const t = tabs.find(x => x.wcId === d.id); if (t) { t.blocked++; if (t.id === cur) { paintBar(); if (!$("setPop").hidden) paintSettings(); } } });
  let popUrl = "";
  B.onPopup(d => { const t = tabs.find(x => x.wcId === d.from); if (!t || t.id !== cur) return; popUrl = d.url; $("popUrl").textContent = d.url.replace(/^https?:\/\//, "").slice(0, 80); $("popNote").hidden = false; clearTimeout(B._pt); B._pt = setTimeout(() => { $("popNote").hidden = true; }, 10000); });
  $("popOpen").onclick = () => { if (popUrl) newTab(popUrl); $("popNote").hidden = true; };
  $("popX").onclick = () => { $("popNote").hidden = true; };
  // menu actions
  const ACT = {
    newtab: () => newTab(""), reopen: () => { const u = closed.pop(); if (u) newTab(u); },
    history: () => togglePop("hiPop"), downloads: () => togglePop("dlPop"), settings: () => { togglePop("setPop"); paintSettings(); },
    bmbar: () => { bmBar = !bmBar; store.set("bmBar", bmBar); bmRender(); },
    find: () => findOpen(), zoom: () => zoomBy(0), full: () => B.full()
  };
  document.querySelectorAll("#menu .mi").forEach(b => b.onclick = () => { closePops(); (ACT[b.dataset.a] || (() => {}))(); });
  function zoomBy(d) { const t = now(); if (!t || !t.wv) return; t.zoom = d === 0 ? 1 : Math.max(.3, Math.min(3, Math.round((t.zoom + d) * 10) / 10)); try { t.wv.setZoomFactor(t.zoom); } catch {} paintBar(); toast("Zoom " + Math.round(t.zoom * 100) + "%"); }
  // find on page
  function findOpen() { const t = now(); if (!t || !t.wv) return; $("find").hidden = false; $("findQ").focus(); $("findQ").select(); }
  function findClose() { $("find").hidden = true; const t = now(); try { t && t.wv && t.wv.stopFindInPage("clearSelection"); } catch {} }
  $("findQ").addEventListener("input", () => { const t = now(), q = $("findQ").value; if (!t || !t.wv) return; if (q) t.wv.findInPage(q); else { t.wv.stopFindInPage("clearSelection"); $("findN").textContent = ""; } });
  $("findQ").addEventListener("keydown", e => { const t = now(); if (e.key === "Enter" && t && t.wv && $("findQ").value) t.wv.findInPage($("findQ").value, { forward: !e.shiftKey, findNext: true }); if (e.key === "Escape") findClose(); });
  $("findDn").onclick = () => { const t = now(); if (t && t.wv && $("findQ").value) t.wv.findInPage($("findQ").value, { findNext: true }); };
  $("findUp").onclick = () => { const t = now(); if (t && t.wv && $("findQ").value) t.wv.findInPage($("findQ").value, { forward: false, findNext: true }); };
  $("findX").onclick = findClose;

  /* ---------- buttons and keys ---------- */
  $("newTab").onclick = () => newTab("");
  $("bBack").onclick = () => { const t = now(); try { t && t.wv && t.wv.canGoBack() && t.wv.goBack(); } catch {} };
  $("bFwd").onclick = () => { const t = now(); try { t && t.wv && t.wv.canGoForward() && t.wv.goForward(); } catch {} };
  $("bReload").onclick = () => { const t = now(); if (!t || !t.wv) return; if (t.loading) t.wv.stop(); else t.wv.reload(); };
  $("bHome").onclick = () => { const t = now(); if (!t) return; t.url = ""; t.title = ""; t.icon = ""; if (t.wv) { t.wv.remove(); t.wv = null; } select(t.id); };
  $("bStar").onclick = bmToggle;
  $("bShield").onclick = () => { togglePop("setPop"); paintSettings(); };
  $("bDl").onclick = () => togglePop("dlPop");
  $("bMenu").onclick = () => togglePop("menu");
  $("urlForm").onsubmit = e => { e.preventDefault(); const v = $("url").value; $("url").blur(); go(v); };
  $("url").addEventListener("focus", () => setTimeout(() => $("url").select(), 0));
  $("url").addEventListener("keydown", e => { if (e.key === "Escape") { $("url").blur(); paintBar(); } });
  $("sForm").onsubmit = e => { e.preventDefault(); const v = $("sq").value; $("sq").value = ""; go(v); };
  $("wMin").onclick = () => B.min(); $("wMax").onclick = () => B.max(); $("wClose").onclick = () => B.close();
  document.querySelector(".drag").ondblclick = () => B.max(); document.querySelector(".head").ondblclick = e => { if (!e.target.closest(".wbtns")) B.max(); };
  B.onWin(s => { document.body.classList.toggle("full", !!s.full); });
  function key(k) {
    const t = now(), wv = t && t.wv;
    if (k === "ctrl+t") newTab("");
    else if (k === "ctrl+w") { if (t) close(t.id); }
    else if (k === "ctrl+l") { $("url").focus(); }
    else if (k === "ctrl+r" || k === "f5") { if (wv) wv.reload(); }
    else if (k === "ctrl+shift+t") ACT.reopen();
    else if (k === "ctrl+tab" || k === "ctrl+shift+tab") { const i = tabs.findIndex(x => x.id === cur); const n = tabs[(i + (k === "ctrl+tab" ? 1 : tabs.length - 1)) % tabs.length]; if (n) select(n.id); }
    else if (/^ctrl\+[1-9]$/.test(k)) { const n = +k.slice(-1); const x = n === 9 ? tabs[tabs.length - 1] : tabs[n - 1]; if (x) select(x.id); }
    else if (k === "ctrl+d") bmToggle();
    else if (k === "ctrl+h") togglePop("hiPop");
    else if (k === "ctrl+j") togglePop("dlPop");
    else if (k === "ctrl+f") findOpen();
    else if (k === "ctrl+=" || k === "ctrl++") zoomBy(.1);
    else if (k === "ctrl+-") zoomBy(-.1);
    else if (k === "ctrl+0") zoomBy(0);
    else if (k === "f11") B.full();
    else if (k === "f12") { try { wv && wv.openDevTools(); } catch {} }
    else if (k === "alt+arrowleft") $("bBack").click();
    else if (k === "alt+arrowright") $("bFwd").click();
    else if (k === "alt+home") $("bHome").click();
  }
  B.onKey(key);
  document.addEventListener("keydown", e => {
    const k = e.key.toLowerCase(), c = e.ctrlKey || e.metaKey;
    let combo = null;
    if (c && !e.altKey) combo = e.shiftKey ? (k === "t" ? "ctrl+shift+t" : k === "tab" ? "ctrl+shift+tab" : null) : (["t", "w", "l", "r", "tab", "d", "h", "j", "f", "=", "+", "-", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"].includes(k) ? "ctrl+" + k : null);
    else if (k === "f5" || k === "f11" || k === "f12") combo = k;
    else if (e.altKey && !c && (k === "arrowleft" || k === "arrowright" || k === "home")) combo = "alt+" + k;
    else if (k === "escape") { closePops(); if (!$("find").hidden) findClose(); }
    if (combo) { e.preventDefault(); key(combo); }
  });
  B.onOpen(d => newTab(d.url, d.bg));

  // a small in-app prompt (Electron has no window.prompt)
  window.__prompt = null;
  (() => {
    const wrap = mk("div", "pop"); wrap.style.cssText = "top:120px;left:50%;right:auto;transform:translateX(-50%);width:380px"; wrap.hidden = true;
    const lab = mk("h4"), inp = mk("input"); inp.style.cssText = "width:100%;padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:var(--surface2);color:var(--ink);font:14px var(--f-body);outline:none;user-select:text";
    const row = mk("div"); row.style.cssText = "display:flex;justify-content:flex-end;gap:14px;margin-top:10px"; const ok = mk("button", "", "OK"), no = mk("button", "", "Cancel");
    ok.style.cssText = "color:var(--accent);font-weight:700"; no.style.cssText = "color:var(--muted)"; row.append(no, ok); wrap.append(lab, inp, row); document.body.append(wrap);
    let res = null;
    window.__askAsync = (label, val) => new Promise(r => { lab.textContent = label; inp.value = val || ""; wrap.hidden = false; inp.focus(); inp.select(); res = r; });
    const done = v => { wrap.hidden = true; if (res) { const r = res; res = null; r(v); } };
    ok.onclick = () => done(inp.value); no.onclick = () => done(null);
    inp.addEventListener("keydown", e => { if (e.key === "Enter") done(inp.value); if (e.key === "Escape") done(null); });
  })();
  // the shortcut "Add" button uses the in-app prompt
  const addOrig = startRender;
  startRender = function () {
    addOrig();
    const add = document.querySelector("#quick .qadd"); if (!add) return;
    add.onclick = async () => {
      const last = (hist[0] && hist[0].u) || "";
      const u = toUrl(await window.__askAsync("Web address for the shortcut", last) || ""); if (!u) return;
      const n = ((await window.__askAsync("Name", host(u).split(".")[0].replace(/^./, c => c.toUpperCase()))) || "").trim().slice(0, 20); if (!n) return;
      quick.push({ n, u }); store.set("quick", quick); startRender();
    };
  };

  /* ---------- update pill ---------- */
  const updShow = () => { $("upd").hidden = false; };
  B.onUpd(updShow);
  B.updGet().then(u => { if (u && u.state === "ready") updShow(); }).catch(() => {});
  $("updGo").onclick = () => { save(); B.restart(); };
  $("updX").onclick = () => { $("upd").hidden = true; setTimeout(updShow, 2 * 3600e3); };

  /* ---------- start ---------- */
  bmRender();
  const saved = store.get("tabs", null);
  const list = saved && Array.isArray(saved.list) ? saved.list.filter(x => x && /^https?:\/\//i.test(x.url)) : [];
  if (list.length) {
    list.forEach(x => tabs.push({ id: ++seq, url: x.url, title: x.title || "", icon: "", loading: false, audible: false, wv: null, blocked: 0, wcId: 0, zoom: 1 }));
    select(tabs[Math.min(Math.max(0, saved.cur | 0), tabs.length - 1)].id);   // the other tabs load when you open them
  } else newTab("");
  // opened from a link in another app (when Blackwall is your default browser)
  B.startUrl().then(u => { if (u) newTab(u); }).catch(() => {});
  setInterval(() => { if (now() && now().wv) paintBar(); }, 1500);
})();
