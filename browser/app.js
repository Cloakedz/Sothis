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
  const ICON_MUTE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16 9 5 6M21 9l-5 6"/></svg>';
  const ICON_SPLIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 5v14"/></svg>';
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
  // Home isn't a tab: it's what you see with no tab picked (the logo, top-left). Searching from Home opens a tab.
  // Setting: pause videos in a tab when you leave it, and carry on when you come back
  let autoPause = store.get("autoPause", true);
  const PAUSE_JS = `(() => { let n = 0; document.querySelectorAll("video, audio").forEach(v => { if (!v.paused && !v.ended) { v.pause(); v.dataset.sbPaused = "1"; n++; } }); return n; })()`;
  const RESUME_JS = `(() => { document.querySelectorAll("video[data-sb-paused], audio[data-sb-paused]").forEach(v => { delete v.dataset.sbPaused; v.play().catch(() => {}); }); })()`;
  function leaveTab(id) { if (!autoPause || id == null) return; const t = tabs.find(x => x.id === id); if (t && t.wv) { try { t.wv.executeJavaScript(PAUSE_JS).then(n => { if (n) { t.bgPaused = true; setTimeout(miniTick, 200); } }).catch(() => {}); } catch {} } }
  function enterTab(t) { if (!autoPause || !t || !t.wv) return; try { t.wv.executeJavaScript(RESUME_JS, true).catch(() => {}); } catch {} }
  function goHome() {
    { const old = now(); if (old) old.seen = Date.now(); }
    leaveTab(cur);
    cur = null;
    tabs.forEach(x => { if (x.wv) x.wv.classList.add("off"); });
    $("start").hidden = false; startRender();
    layoutSplit(); tear($("start"));
    renderTabs(); paintBar(); save(); setTimeout(miniTick, 50);
    setTimeout(() => { $("url").focus(); }, 30);   // Home: type in the bar at the top
  }
  function newTab(url, bg) {
    if (!url) { goHome(); return null; }
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
    wv.addEventListener("dom-ready", () => { try { t.wcId = wv.getWebContentsId(); } catch {} try { wv.setZoomFactor(t.zoom); } catch {} try { wv.setAudioMuted(!!t.muted); } catch {} }, { once: false });
    wv.addEventListener("focus", () => { if (split && cur !== t.id && inSplit(t.id) && splitShown()) select(t.id); });
    wv.addEventListener("did-start-loading", () => { t.loading = true; paint(t); });
    wv.addEventListener("did-stop-loading", () => { t.loading = false; paint(t); });
    wv.addEventListener("did-navigate", e => { { const v = u => { try { return new URL(u).searchParams.get("v") || u; } catch { return u; } }; if (v(e.url) !== v(t.url)) t.ytAt = 0; } t.url = e.url; t.blocked = 0; t.trackers = 0; t.hosts = {}; addHistory(t); paint(t); save(); });
    wv.addEventListener("did-navigate-in-page", e => { if (e.isMainFrame) { const v = u => { try { return new URL(u).searchParams.get("v") || u; } catch { return u; } }; if (v(e.url) !== v(t.url)) t.ytAt = 0; t.url = e.url; paint(t); save(); } });
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
    const paneSwap = split && inSplit(id) && inSplit(cur);   // clicking between the two halves of split view
    if (cur !== id) { const old = now(); if (old) old.seen = Date.now(); if (!paneSwap) { leaveTab(cur); setTimeout(() => enterTab(t), 60); } }
    const changed = cur !== id;
    cur = id; t.seen = Date.now(); t.asleep = false; t.bgPaused = false; t.miniX = false;
    tabs.forEach(x => { if (x.wv) x.wv.classList.toggle("off", x.id !== id); });
    if (t.url && !t.wv) { const r = resumeUrl(t); if (r !== t.url) t.url = r; makeView(t); }
    if (t.wv) t.wv.classList.remove("off");
    $("start").hidden = !!t.url;
    if (!t.url) startRender();
    layoutSplit();
    if (changed && !paneSwap) tear(t.wv || $("start"));
    renderTabs(); paintBar(); save(); setTimeout(miniTick, 50);
    try { clearTimeout(select.pt); select.pt = setTimeout(pingTick, 400); } catch {}
    if (!t.url) setTimeout(() => $("url").focus(), 30);
  }
  function close(id) {
    const i = tabs.findIndex(t => t.id === id); if (i < 0) return;
    const [t] = tabs.splice(i, 1);
    if (t.url) { closed.push(t.url); if (closed.length > 25) closed.shift(); }
    if (t.wv) t.wv.remove();
    if (split && inSplit(id)) { split = null; layoutSplit(); }
    groupTidy();
    if (!tabs.length) { goHome(); return; }
    if (cur === id) select(tabs[Math.min(i, tabs.length - 1)].id); else { renderTabs(); save(); }
  }
  function go(q) {
    const url = toUrl(q); if (!url) return;
    let t = now();
    if (!t) { t = newTab(url); try { t.wv.focus(); } catch {} return; }   // from Home: a new tab
    t.url = url; t.title = ""; t.icon = "";
    if (t.wv) t.wv.loadURL(url).catch(() => {}); else makeView(t);
    select(t.id);
    try { t.wv.focus(); } catch {}
  }
  function paint(t) { renderTabs(); if (t.id === cur) paintBar(); }
  let tabDrag = null;
  /* ---------- tab groups (like Chrome): a named, coloured chip; click it to fold its tabs away ---------- */
  const GCOL = { grey: "#8b8f9c", blue: "#5b8def", red: "#e3192f", yellow: "#f2b33d", green: "#3ccf8e", pink: "#ff5fa2", purple: "#a77bff", cyan: "#3cc8e0", orange: "#ff8a3d" };
  let groups = store.get("groups", []); if (!Array.isArray(groups)) groups = [];
  const grp = id => groups.find(g => g.id === id);
  function groupTidy() {   // keep each group's tabs side by side, and forget empty groups
    const order = []; const seen = new Set();
    tabs.forEach(t => { if (!t.g || !grp(t.g)) { t.g = 0; order.push(t); return; } if (seen.has(t.g)) return; seen.add(t.g); tabs.filter(x => x.g === t.g).forEach(x => order.push(x)); });
    tabs.splice(0, tabs.length, ...order);
    groups = groups.filter(g => tabs.some(t => t.g === g.id));
  }
  async function groupNew(t) {
    const used = new Set(groups.map(g => g.color)), color = Object.keys(GCOL).find(c => !used.has(c)) || "grey";
    const g = { id: Date.now(), name: "", color, collapsed: false };
    groups.push(g); groupAdd(t, g);
    const n = await window.__askAsync("Name this group (or leave it blank)", "");
    if (n != null) { g.name = n.trim().slice(0, 30); renderTabs(); save(); }
  }
  function groupAdd(t, g) {
    t.g = g.id; const last = [...tabs].reverse().find(x => x.g === g.id && x !== t);
    if (last) { tabs.splice(tabs.indexOf(t), 1); tabs.splice(tabs.indexOf(last) + 1, 0, t); }
    g.collapsed = false; groupTidy(); renderTabs(); save();
  }
  function groupMenu(e, g) {
    e.preventDefault(); e.stopPropagation();
    const rows = [
      { label: "Rename group", act: async () => { const n = await window.__askAsync("Group name", g.name); if (n != null) { g.name = n.trim().slice(0, 30); renderTabs(); save(); } } },
      { label: "Colour", sub: () => Object.entries(GCOL).map(([k, v]) => ({ label: k[0].toUpperCase() + k.slice(1) + (g.color === k ? "  ✓" : ""), dot: v, act: () => { g.color = k; renderTabs(); save(); } })) },
      { label: g.collapsed ? "Expand group" : "Collapse group", act: () => { g.collapsed = !g.collapsed; if (g.collapsed && now() && now().g === g.id) { const o = tabs.find(x => x.g !== g.id); if (o) select(o.id); else goHome(); } renderTabs(); save(); } },
      "-",
      { label: "Ungroup", act: () => { tabs.forEach(t => { if (t.g === g.id) t.g = 0; }); groupTidy(); renderTabs(); save(); } },
      { label: "Close group", act: () => { tabs.filter(t => t.g === g.id).forEach(t => close(t.id)); } }
    ];
    menuAt(e.clientX, e.clientY, 0, rows);
  }
  function tabMenu(e, t) {
    e.preventDefault(); e.stopPropagation();
    const others = groups.filter(g => g.id !== t.g);
    const rows = [
      { label: "Add tab to new group", act: () => groupNew(t) },
      others.length ? { label: "Add tab to group", sub: () => others.map(g => ({ label: g.name || "Unnamed group", dot: GCOL[g.color], act: () => groupAdd(t, g) })) } : null,
      t.g ? { label: "Remove from group", act: () => { const gid = t.g; t.g = 0; tabs.splice(tabs.indexOf(t), 1); const last = tabs.map(x => x.g).lastIndexOf(gid); tabs.splice(last + 1, 0, t); groupTidy(); renderTabs(); save(); } } : null,
      "-",
      inSplit(t.id) ? { label: "Exit split view", act: () => splitEnd() } : (cur != null && cur !== t.id && t.url && now() && now().url ? { label: "Split view with current tab", act: () => splitStart(cur, t.id) } : null),
      (t.audible || t.muted) || t.wv ? { label: t.muted ? "Unmute tab" : "Mute tab", act: () => muteTab(t) } : null,
      "-",
      { label: "Duplicate", act: () => { const d = newTab(t.url, true); if (d && t.g) { d.g = t.g; groupTidy(); renderTabs(); save(); } } },
      { label: "Close other tabs", act: () => tabs.filter(x => x !== t).forEach(x => close(x.id)) },
      { label: "Close tab", act: () => close(t.id) }
    ].filter(Boolean);
    menuAt(e.clientX, e.clientY, 0, rows);
  }
  function renderTabs() {
    const box = $("tabs"); box.replaceChildren();
    let lastG = 0;
    tabs.forEach(t => {
      const g = t.g ? grp(t.g) : null;
      if (g && g.id !== lastG) {
        const c = mk("div", "tgrp" + (g.collapsed ? " shut" : "")); c.style.setProperty("--gc", GCOL[g.color] || GCOL.grey);
        c.title = (g.name || "Group") + " · " + tabs.filter(x => x.g === g.id).length + " tabs · click to " + (g.collapsed ? "open" : "fold");
        c.append(mk("span", "", g.name || (g.collapsed ? String(tabs.filter(x => x.g === g.id).length) : "")));
        c.onclick = () => { g.collapsed = !g.collapsed; if (g.collapsed && now() && now().g === g.id) { const o = tabs.find(x => x.g !== g.id); if (o) select(o.id); else goHome(); } renderTabs(); save(); };
        c.oncontextmenu = e => groupMenu(e, g);
        c.addEventListener("dragover", e => { if (tabDrag) { e.preventDefault(); c.classList.add("drop"); } });
        c.addEventListener("dragleave", () => c.classList.remove("drop"));
        c.addEventListener("drop", e => { e.preventDefault(); c.classList.remove("drop"); if (tabDrag) { const m = tabDrag; tabDrag = null; m.g = g.id; tabs.splice(tabs.indexOf(m), 1); tabs.splice(tabs.findIndex(x => x.g === g.id), 0, m); g.collapsed = false; groupTidy(); renderTabs(); save(); } });
        box.append(c);
      }
      lastG = g ? g.id : 0;
      if (g && g.collapsed) return;
      const b = mk("div", "tab" + (t.id === cur ? " on" : "") + (g ? " ing" : "") + (t.asleep ? " asleep" : "")); b.setAttribute("role", "tab"); b.title = (t.title || t.url || "New tab") + (t.asleep ? " (asleep to save memory; click to wake)" : "");
      if (g) b.style.setProperty("--gc", GCOL[g.color] || GCOL.grey);
      if (inSplit(t.id)) { b.classList.add("sp"); if (splitShown()) b.classList.add("spon"); }
      b.oncontextmenu = e => tabMenu(e, t);
      if (t.loading) b.append(mk("i", "spin"));
      else if (t.icon || t.url) { const im = mk("img"); im.alt = ""; im.src = t.icon || favi(t.url); im.onerror = () => { im.replaceWith(mk("span", "fi", (host(t.url) || "?")[0].toUpperCase())); }; b.append(im); }
      else { const im = mk("img"); im.alt = ""; im.src = "assets/blackwall.png"; b.append(im); }
      b.append(mk("span", "t", t.title || (t.url ? host(t.url) : "New tab")));
      if (inSplit(t.id)) { const s = mk("span", "spi"); s.innerHTML = ICON_SPLIT; s.title = "In split view"; b.append(s); }
      if (t.audible || t.muted) { const s = mk("button", "snd" + (t.muted ? " muted" : "")); s.type = "button"; s.title = t.muted ? "Unmute tab" : "Mute tab"; s.setAttribute("aria-label", s.title); s.innerHTML = t.muted ? ICON_MUTE : ICON_SND; s.onclick = e => { e.stopPropagation(); muteTab(t); }; s.onmousedown = e => e.stopPropagation(); b.append(s); }
      const x = mk("button", "x"); x.type = "button"; x.setAttribute("aria-label", "Close tab"); x.innerHTML = ICON_X;
      x.onclick = e => { e.stopPropagation(); close(t.id); };
      b.onmousedown = e => { if (e.button === 1) { e.preventDefault(); close(t.id); } };
      b.onclick = () => select(t.id);
      // drag a tab left or right to reorder
      b.draggable = true;
      b.addEventListener("dragstart", e => { tabDrag = t; e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", t.url || ""); } catch {} requestAnimationFrame(() => b.classList.add("dragging")); });
      b.addEventListener("dragend", () => { tabDrag = null; document.querySelectorAll(".tab.dragging, .tab.drop-l, .tab.drop-r").forEach(el => el.classList.remove("dragging", "drop-l", "drop-r")); });
      b.addEventListener("dragover", e => {
        if (!tabDrag || tabDrag === t) return; e.preventDefault();
        const r = b.getBoundingClientRect(), right = e.clientX > r.left + r.width / 2;
        b.classList.toggle("drop-r", right); b.classList.toggle("drop-l", !right);
      });
      b.addEventListener("dragleave", () => b.classList.remove("drop-l", "drop-r"));
      b.addEventListener("drop", e => {
        e.preventDefault(); if (!tabDrag || tabDrag === t) return;
        const right = b.classList.contains("drop-r"), moving = tabDrag;
        tabs.splice(tabs.indexOf(moving), 1);
        tabs.splice(tabs.indexOf(t) + (right ? 1 : 0), 0, moving);
        moving.g = t.g || 0;   // dropped among a group's tabs: it joins that group
        tabDrag = null; groupTidy(); renderTabs(); save();
      });
      b.append(x); box.append(b);
    });
    document.title = (now() && now().title ? now().title + " · " : "") + "Blackwall";
    $("homeBtn").classList.toggle("on", cur === null);
  }
  function paintBar() {
    const t = now() || { url: "", loading: false, blocked: 0, zoom: 1, wv: null };   // Home
    const wv = t.wv;
    let back = false, fwd = false; try { back = !!(wv && wv.canGoBack()); fwd = !!(wv && wv.canGoForward()); } catch {}
    $("bBack").disabled = !back; $("bFwd").disabled = !fwd;
    $("bReloadI").setAttribute("d", t.loading ? STOP : RELOAD);
    if (document.activeElement !== $("url")) $("url").value = t.url || "";
    const secure = /^https:/.test(t.url);
    $("urlIc").classList.toggle("lock", secure);
    $("urlIc").innerHTML = t.url ? (secure ? '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>' : '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>') : '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>';
    $("urlIc").setAttribute("title", t.url ? (secure ? "Connection is secure" : "This page isn't using a secure connection") : "");
    const bm = !!bmFindUrl(t.url);
    $("bStar").classList.toggle("on", bm); $("bStarI").setAttribute("fill", bm ? "currentColor" : "none");
    $("bStar").disabled = !t.url;
    $("shieldN").textContent = cfg.adBlock && t.blocked ? (t.blocked > 99 ? "99+" : String(t.blocked)) : "";
    $("bShield").classList.toggle("on", cfg.adBlock);
    $("zoomT").textContent = Math.round((t.zoom || 1) * 100) + "%";
    prog();
  }
  function prog() {
    const t = now(), on = !!(t && t.loading);
    $("scan").classList.toggle("on", on);
    $("prog").classList.toggle("on", on);
    $("progI").style.width = on ? "70%" : "100%";
    if (!on) setTimeout(() => { if (!(now() && now().loading)) $("progI").style.width = "0"; }, 400);
  }
  // YouTube: remember how far into the video you were, so it picks up there after a restart (or when a sleeping tab wakes)
  const isYtWatch = u => /^https:\/\/(www\.|m\.)?youtube\.com\/(watch|shorts\/|live\/)/i.test(u || "") || /^https:\/\/youtu\.be\//i.test(u || "");
  function resumeUrl(t) {
    if (!t.ytAt || !isYtWatch(t.url) || t.ytAt < 5) return t.url;
    try { const u = new URL(t.url); u.searchParams.set("t", Math.floor(t.ytAt) + "s"); return u.href; } catch { return t.url; }
  }
  async function ytRemember() {
    let changed = false;
    for (const t of tabs) {
      if (!t.wv || !isYtWatch(t.url)) continue;
      try {
        const at = await t.wv.executeJavaScript(`(() => { const v = document.querySelector("video"); return v && isFinite(v.currentTime) ? (v.duration && v.currentTime > v.duration - 8 ? 0 : v.currentTime) : -1; })()`);
        if (at >= 0 && Math.abs((t.ytAt || 0) - at) >= 2) { t.ytAt = at; changed = true; }
      } catch {}
    }
    if (changed) save();
  }
  setInterval(ytRemember, 5000);
  window.addEventListener("beforeunload", () => save());
  function save() { store.set("groups", groups); store.set("tabs", { list: tabs.filter(t => t.url).map(t => ({ url: resumeUrl(t), title: t.title, g: t.g || 0 })), cur: cur === null ? -1 : Math.max(0, tabs.filter(t => t.url).findIndex(t => t.id === cur)) }); }

  /* ---------- bookmarks, shortcuts, history ---------- */
  const QUICK_DEF = [["YouTube", "https://www.youtube.com/"], ["Google", "https://www.google.com/"], ["Reddit", "https://www.reddit.com/"], ["Twitch", "https://www.twitch.tv/"],
    ["Nexus Mods", "https://www.nexusmods.com/"], ["Modrinth", "https://modrinth.com/"], ["Gmail", "https://mail.google.com/"]].map(([n, u]) => ({ n, u }));
  let quick = store.get("quick", null); if (!Array.isArray(quick)) quick = QUICK_DEF.slice();
  let bms = store.get("bookmarks", []); if (!Array.isArray(bms)) bms = [];
  (function fix(list) { list.forEach(n => { if (n.f && !Array.isArray(n.items)) n.items = []; if (n.f) fix(n.items); }); })(bms);
  let hist = store.get("history", []); if (!Array.isArray(hist)) hist = [];
  let bmBar = store.get("bmBar", true);
  function addHistory(t) {
    if (!/^https?:/.test(t.url)) return;
    hist = hist.filter(h => h.u !== t.url); hist.unshift({ u: t.url, t: t.title || host(t.url), at: Date.now() });
    if (hist.length > 1500) hist.length = 1500; store.set("history", hist);
  }
  function updHistoryTitle(t) { const h = hist.find(x => x.u === t.url); if (h && t.title) { h.t = t.title; store.set("history", hist); } }
  /* bookmarks: links and folders, and folders can hold more folders. Saved as a tree: { u, t } for a link, { f: true, t, items } for a folder */
  const FOLDER_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
  const CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
  const bmSave = () => { store.set("bookmarks", bms); bmRender(); paintBar(); };
  function bmWalk(list, fn, parent) { for (const n of list) { if (fn(n, list, parent) === false) return false; if (n.f && bmWalk(n.items, fn, n) === false) return false; } }
  function bmFindUrl(url) { let hit = null; bmWalk(bms, (n, list) => { if (!n.f && n.u === url) { hit = { n, list }; return false; } }); return hit; }
  function bmListOf(node) { let hit = null; bmWalk(bms, (n, list) => { if (n === node) { hit = list; return false; } }); return hit; }
  function bmRemove(node) { const l = bmListOf(node); if (l) l.splice(l.indexOf(node), 1); }
  const bmInside = (folder, node) => { let yes = false; if (folder === node) return true; bmWalk(node.f ? node.items : [], n => { if (n === folder) { yes = true; return false; } }); return yes; };
  function bmFolders() { const out = [{ t: "Bookmarks bar", items: bms, depth: 0, root: true }]; const rec = (list, d) => list.forEach(n => { if (n.f) { out.push({ node: n, t: n.t, items: n.items, depth: d }); rec(n.items, d + 1); } }); rec(bms, 1); return out; }
  function bmMove(node, toList, before) {
    if (node.f && toList !== bms) { const owner = bmFolders().find(x => x.items === toList); if (owner && owner.node && bmInside(owner.node, node)) { toast("A folder can't go inside itself"); return; } }
    bmRemove(node);
    const i = before ? toList.indexOf(before) : -1;
    if (i >= 0) toList.splice(i, 0, node); else toList.push(node);
    bmSave();
  }
  function bmToggle() {
    const t = now(); if (!t || !t.url) return;
    const hit = bmFindUrl(t.url);
    if (hit) { hit.list.splice(hit.list.indexOf(hit.n), 1); toast("Bookmark removed"); }
    else { bms.push({ u: t.url, t: t.title || host(t.url) }); toast("Bookmarked. Right-click it to move it into a folder"); }
    bmSave();
  }
  async function bmNewFolder(intoList) {
    const name = ((await window.__askAsync("Folder name", "New folder")) || "").trim().slice(0, 40); if (!name) return;
    (intoList || bms).push({ f: true, t: name, items: [] }); bmSave(); toast("Folder made. Drag bookmarks or folders onto it");
  }
  // one small menu at a time: right-click menus and folder drop-downs (with fly-outs for folders inside folders)
  let menus = [];
  function menuClose(fromLevel) { menus.filter(m => m.level >= (fromLevel || 0)).forEach(m => m.el.remove()); menus = menus.filter(m => m.level < (fromLevel || 0)); }
  document.addEventListener("mousedown", e => { if (!e.target.closest(".cm, .bm")) menuClose(0); });
  window.addEventListener("blur", () => menuClose(0));
  function menuAt(x, y, level, rows) {
    menuClose(level);
    const m = mk("div", "cm"); m.setAttribute("role", "menu");
    rows.forEach(r => {
      if (r === "-") { m.append(mk("div", "cm-sep")); return; }
      const b = mk("button", "cm-r" + (r.dim ? " dim" : "")); b.type = "button";
      if (r.dot) { const d = mk("span", "cm-dot"); d.style.background = r.dot; b.append(d); }
      if (r.icon) { const ic = r.icon === "folder" ? mk("span", "cm-i") : mk("img", "cm-i"); if (r.icon === "folder") ic.innerHTML = FOLDER_SVG; else { ic.alt = ""; ic.src = r.icon; ic.onerror = () => ic.remove(); } b.append(ic); }
      b.append(mk("span", "cm-t", r.label));
      if (r.sub) { const c = mk("span", "cm-c"); c.innerHTML = CHEV; b.append(c); }
      if (r.sub) { const open = () => { const rc = b.getBoundingClientRect(); menuAt(rc.right - 4, rc.top - 6, level + 1, r.sub()); }; b.onmouseenter = open; b.onclick = e => { e.stopPropagation(); open(); }; }
      else { b.onmouseenter = () => menuClose(level + 1); b.onclick = e => { menuClose(0); r.act && r.act(e); }; }
      if (r.node) bmDragHooks(b, r.node, r.list);
      if (r.dropInto) bmDropInto(b, r.dropInto);
      m.append(b);
    });
    document.body.append(m);
    const w = m.offsetWidth, h = m.offsetHeight;
    m.style.left = Math.max(6, Math.min(x, innerWidth - w - 6)) + "px"; m.style.top = Math.max(6, Math.min(y, innerHeight - h - 6)) + "px";
    menus.push({ el: m, level });
    return m;
  }
  // a folder's contents as menu rows (sub-folders open to the side)
  function bmRows(list) {
    const rows = list.map(n => n.f
      ? { label: n.t || "Folder", icon: "folder", sub: () => bmRows(n.items), node: n, list, dropInto: n.items }
      : { label: n.t || host(n.u), icon: favi(n.u), act: e => (e.ctrlKey ? newTab(n.u, true) : go(n.u)), node: n, list });
    if (!rows.length) rows.push({ label: "Empty. Drag bookmarks here", dim: true, act: () => {} });
    const links = list.filter(n => !n.f);
    if (links.length > 1) rows.push("-", { label: "Open all (" + links.length + ") in new tabs", act: () => links.forEach(n => newTab(n.u, true)) });
    return rows;
  }
  function bmMoveRows(node) {
    return bmFolders().filter(f => !(node.f && f.node && bmInside(f.node, node))).map(f => ({ label: " ".repeat(f.depth * 3) + f.t, icon: "folder", act: () => { bmMove(node, f.items); toast("Moved to " + f.t); } }));
  }
  function bmContext(e, node, list) {
    e.preventDefault(); e.stopPropagation();
    const rows = node.f ? [
      { label: "Open all in new tabs", act: () => { let n = 0; bmWalk(node.items, x => { if (!x.f) { newTab(x.u, true); n++; } }); if (!n) toast("Nothing in this folder yet"); } },
      { label: "New folder inside", act: () => bmNewFolder(node.items) },
      "-",
      { label: "Rename", act: async () => { const v = ((await window.__askAsync("Folder name", node.t)) || "").trim().slice(0, 40); if (v) { node.t = v; bmSave(); } } },
      { label: "Move to", sub: () => bmMoveRows(node) },
      { label: "Delete folder", act: () => { let n = 0; bmWalk(node.items, x => { n++; }); bmRemove(node); bmSave(); toast(n ? "Folder and " + n + " item" + (n === 1 ? "" : "s") + " in it deleted" : "Folder deleted"); } }
    ] : [
      { label: "Open in new tab", act: () => newTab(node.u, true) },
      "-",
      { label: "Rename", act: async () => { const v = ((await window.__askAsync("Bookmark name", node.t)) || "").trim().slice(0, 80); if (v) { node.t = v; bmSave(); } } },
      { label: "Move to", sub: () => bmMoveRows(node) },
      { label: "New folder", act: () => bmNewFolder(list) },
      { label: "Delete", act: () => { bmRemove(node); bmSave(); toast("Bookmark removed"); } }
    ];
    menuAt(e.clientX, e.clientY, 0, rows);
  }
  // drag a bookmark or folder: drop it on a folder to put it inside, or on another bookmark to place it there
  let bmDrag = null;
  function bmDragHooks(el, node, list) {
    el.draggable = true;
    el.addEventListener("dragstart", e => { bmDrag = node; e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", node.u || node.t); } catch {} el.classList.add("dragging"); });
    el.addEventListener("dragend", () => { bmDrag = null; el.classList.remove("dragging"); document.querySelectorAll(".drop-in, .drop-before").forEach(x => x.classList.remove("drop-in", "drop-before")); });
    el.addEventListener("contextmenu", e => bmContext(e, node, list));
    if (!node.f) el.addEventListener("dragover", e => { if (!bmDrag || bmDrag === node) return; e.preventDefault(); el.classList.add("drop-before"); });
    if (!node.f) el.addEventListener("dragleave", () => el.classList.remove("drop-before"));
    if (!node.f) el.addEventListener("drop", e => { e.preventDefault(); el.classList.remove("drop-before"); if (bmDrag && bmDrag !== node) bmMove(bmDrag, list, node); });
  }
  function bmDropInto(el, items) {
    let t = null;
    el.addEventListener("dragover", e => { if (!bmDrag || bmDrag.items === items) return; e.preventDefault(); el.classList.add("drop-in"); if (!t) t = setTimeout(() => { if (el.isConnected && bmDrag) el.click(); }, 700); });   // hover a folder to open it while dragging
    el.addEventListener("dragleave", () => { el.classList.remove("drop-in"); clearTimeout(t); t = null; });
    el.addEventListener("drop", e => { e.preventDefault(); e.stopPropagation(); el.classList.remove("drop-in"); clearTimeout(t); t = null; const f = bmFolders().find(x => x.items === items); if (bmDrag) { const nm = f ? f.t : "folder"; bmMove(bmDrag, items); toast("Moved into " + nm); menuClose(0); } });
  }
  function bmRender() {
    const box = $("bms"); box.replaceChildren(); box.hidden = !bmBar;
    $("bmbarT").textContent = bmBar ? "Hide bookmarks bar" : "Show bookmarks bar";
    bms.forEach(b => {
      const e = mk("button", "bm" + (b.f ? " fold" : "")); e.type = "button"; e.title = b.f ? b.t : b.u;
      if (b.f) {
        const ic = mk("span", "bm-f"); ic.innerHTML = FOLDER_SVG; e.append(ic, mk("span", "", b.t || "Folder"));
        e.onclick = ev => { ev.stopPropagation(); const r = e.getBoundingClientRect(); if (menus.some(m => m.level === 0 && m.for === b)) { menuClose(0); return; } const m = menuAt(r.left, r.bottom + 4, 0, bmRows(b.items)); menus[menus.length - 1].for = b; };
        bmDropInto(e, b.items);
      } else {
        const im = mk("img"); im.alt = ""; im.src = favi(b.u); im.onerror = () => im.remove();
        e.append(im, mk("span", "", b.t || host(b.u)));
        e.onclick = ev => { if (ev.ctrlKey) newTab(b.u, true); else go(b.u); };
        e.onauxclick = ev => { if (ev.button === 1) newTab(b.u, true); };
      }
      bmDragHooks(e, b, bms);
      box.append(e);
    });
    if (!bms.length) box.append(mk("span", "bm-hint", "Press the star to bookmark a page. Right-click here for a new folder."));
    // the empty part of the bar: drop at the end, or right-click for a new folder
    box.ondragover = e => { if (bmDrag && e.target === box) e.preventDefault(); };
    box.ondrop = e => { if (bmDrag && e.target === box) { e.preventDefault(); bmMove(bmDrag, bms); } };
    box.oncontextmenu = e => { if (e.target !== box && !e.target.classList.contains("bm-hint")) return; e.preventDefault(); menuAt(e.clientX, e.clientY, 0, [{ label: "New folder", act: () => bmNewFolder(bms) }]); };
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
  const POPS = ["menu", "dlPop", "hiPop", "setPop", "shPop", "sitePop", "sesPop"];
  function closePops(except) { POPS.forEach(p => { if (p !== except) $(p).hidden = true; }); }
  function togglePop(id) { const open = $(id).hidden; closePops(); $(id).hidden = !open; if (open && id === "hiPop") histRender(); if (open && id === "dlPop") { dlSeen = dls.length; dlRender(); } if (open && id === "shPop") shRender(); if (open && id === "sitePop") siteRender(); if (open && id === "sesPop") sesRender(); }
  document.addEventListener("mousedown", e => { if (!e.target.closest(".pop") && !e.target.closest("#bMenu, #bDl, #bShield, #urlIc, .cm")) closePops(); });
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
    $("sAd").setAttribute("aria-checked", cfg.adBlock); $("sPop").setAttribute("aria-checked", cfg.popBlock); $("sDark").setAttribute("aria-checked", !!cfg.forceDark); $("darkN").textContent = cfg.darkNeedsRestart ? "Restart Blackwall to finish switching." : "Makes every site dark, even ones without a dark theme."; $("darkR").hidden = !cfg.darkNeedsRestart; $("sEng").value = cfg.search || "google";
    const t = now(); $("adN").textContent = cfg.adBlock ? (t && t.blocked ? t.blocked + " blocked on this tab." : "Stops known ad servers from loading.") : "Ads load normally.";
    paintBar();
  }
  $("sAd").onclick = async () => { cfg = await B.setCfg({ adBlock: !cfg.adBlock }) || cfg; paintSettings(); toast(cfg.adBlock ? "Ad blocking on. Reload to clear ads already shown" : "Ad blocking off"); };
  $("sPop").onclick = async () => { cfg = await B.setCfg({ popBlock: !cfg.popBlock }) || cfg; paintSettings(); };
  $("sDark").onclick = async () => { cfg = await B.setCfg({ forceDark: !cfg.forceDark }) || cfg; paintSettings(); toast(cfg.darkNeedsRestart ? "Restart Blackwall to finish switching" : cfg.forceDark ? "Force dark mode on" : "Force dark mode off"); };
  $("darkR").onclick = () => { save(); B.restart(); };
  $("sEng").onchange = async () => { cfg = await B.setCfg({ search: $("sEng").value }) || cfg; paintSettings(); };
  // default browser: Windows only lets you choose this yourself, so this opens the right page in Settings
  const defPaint = () => B.isDefault().then(on => { $("sDefaultT").textContent = on ? "Blackwall is your default browser" : "Make Blackwall your default browser"; }).catch(() => {});
  $("sDefault").onclick = async () => { await B.defaultOpen(); toast("In Settings, set Blackwall for HTTPS and HTTP (or press Set default)"); setTimeout(defPaint, 8000); };
  defPaint();
  $("sPause").setAttribute("aria-checked", autoPause);
  $("sPause").onclick = () => { autoPause = !autoPause; store.set("autoPause", autoPause); $("sPause").setAttribute("aria-checked", autoPause); toast(autoPause ? "Videos pause when you leave a tab" : "Videos keep playing in other tabs"); };
  // bring Chrome's bookmarks in as a folder on the bar (its folders, and folders inside them, come along)
  $("sImport").onclick = async () => {
    const r = await B.importBookmarks("chrome").catch(() => null);
    if (!r || !r.ok) return toast((r && r.err) || "Couldn't import bookmarks");
    let n = 0; const count = l => l.forEach(x => { if (x.f) count(x.items); else n++; });
    r.profiles.forEach(p => count(p.items));
    if (!n) return toast("Chrome has no bookmarks to bring over");
    const items = r.profiles.length === 1 ? r.profiles[0].items : r.profiles.map(p => ({ f: true, t: "Chrome " + p.prof, items: p.items }));
    bms.push({ f: true, t: "From Chrome", items }); bmSave(); closePops();
    toast(n + " bookmark" + (n === 1 ? "" : "s") + " imported into the From Chrome folder");
  };
  $("sClear").onclick = async () => { $("sClear").disabled = true; await B.clearData(); $("sClear").disabled = false; toast("Cookies and site data cleared"); };
  B.onBlocked(d => { const t = tabs.find(x => x.wcId === d.id); if (t) { t.blocked++; if (d.tracker) t.trackers = (t.trackers || 0) + 1; t.hosts = t.hosts || {}; if (d.host) { const h = t.hosts[d.host] || (t.hosts[d.host] = { n: 0, tr: !!d.tracker }); h.n++; } if (t.id === cur) { paintBar(); if (!$("setPop").hidden) paintSettings(); if (!$("shPop").hidden) shRender(); } } });
  let popUrl = "";
  B.onPopup(d => { const t = tabs.find(x => x.wcId === d.from); if (!t || t.id !== cur) return; popUrl = d.url; $("popUrl").textContent = d.url.replace(/^https?:\/\//, "").slice(0, 80); $("popNote").hidden = false; clearTimeout(B._pt); B._pt = setTimeout(() => { $("popNote").hidden = true; }, 10000); });
  $("popOpen").onclick = () => { if (popUrl) newTab(popUrl); $("popNote").hidden = true; };
  $("popX").onclick = () => { $("popNote").hidden = true; };
  // menu actions
  const ACT = {
    newtab: () => newTab(""), reopen: () => { const u = closed.pop(); if (u) newTab(u); },
    history: () => togglePop("hiPop"), downloads: () => togglePop("dlPop"), settings: () => { togglePop("setPop"); paintSettings(); },
    bmbar: () => { bmBar = !bmBar; store.set("bmBar", bmBar); bmRender(); },
    find: () => findOpen(), zoom: () => zoomBy(0), full: () => B.full(),
    sleepall: () => sleepAllNow(),
    split: () => { if (split && splitShown()) return splitEnd(); const t = now(); if (!t || !t.url) return toast("Open a page first"); const o = tabs.filter(x => x.id !== t.id && x.url).sort((x, y) => (y.seen || 0) - (x.seen || 0))[0]; if (!o) return toast("Open another tab to split with"); splitStart(t.id, o.id); },
    sessions: () => togglePop("sesPop"),
    update: async () => { toast("Checking for updates…"); const u = await B.updCheck().catch(() => null); if (!u) return toast("Couldn't check for updates"); if (u.state === "ready") { updShow(); toast("Update " + (u.latest || "") + " is ready"); } else if (u.state === "current") toast("Blackwall " + u.version + " is up to date"); else toast("Couldn't update: " + (u.err || "try again later")); }
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
  $("bHome").onclick = goHome;
  $("homeBtn").onclick = goHome;
  $("bStar").onclick = bmToggle;
  $("bShield").onclick = () => togglePop("shPop");
  $("urlIc").addEventListener("click", () => { if (now() && now().url) togglePop("sitePop"); });
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
  B.onOpen(d => { const from = now(); const t = newTab(d.url, d.bg); if (t && from && from.g) { const i = tabs.indexOf(t); tabs.splice(i, 1); tabs.splice(tabs.indexOf(from) + 1, 0, t); t.g = from.g; groupTidy(); renderTabs(); save(); } });

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

  /* ---------- Home clock ---------- */
  function clockTick() {
    const d = new Date(), tt = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }), m = /^(.*?)\s*([AaPp]\.?\s?[Mm]\.?)$/.exec(tt);
    const el = $("hcT"); if (el.dataset.v !== tt) { el.dataset.v = tt; el.replaceChildren(document.createTextNode(m ? m[1] : tt)); if (m) el.append(mk("small", "", m[2].replace(/[.\s]/g, "").toUpperCase())); }
    $("hcD").textContent = d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  }
  clockTick(); setInterval(clockTick, 1000);

  /* ---------- sleeping tabs: background tabs you haven't looked at for a while are unloaded to free memory ---------- */
  let sleepMin = store.get("sleepMin", 15);
  function sleepTick(now_) {
    if (!sleepMin && !now_) return;
    const cut = now_ ? Infinity : Date.now() - sleepMin * 60e3; let n = 0;
    tabs.forEach(t => {
      if (t.id === cur || !t.wv || t.audible || t.bgPaused || (inSplit(t.id) && splitShown()) || t.loading || (!now_ && (t.seen || Date.now()) > cut)) return;
      try { t.wv.remove(); } catch {}
      t.wv = null; t.wcId = 0; t.asleep = true; n++;
    });
    if (n) renderTabs();
    return n;
  }
  function sleepAllNow() { const n = sleepTick(true); toast(n ? n + " background tab" + (n === 1 ? "" : "s") + " put to sleep" : "Nothing to put to sleep"); setTimeout(statsTick, 1500); }
  setInterval(sleepTick, 60e3);
  $("sSleep").value = String(sleepMin);
  $("sSleep").onchange = () => { sleepMin = +$("sSleep").value || 0; store.set("sleepMin", sleepMin); sleepTick(); toast(sleepMin ? "Tabs sleep after " + sleepMin + " minutes in the background" : "Tabs never sleep"); };

  /* ---------- top-row stats ---------- */
  async function statsTick() {
    const st = await B.stats().catch(() => null); if (!st) return;
    const mb = st.ramMB || 0, ram = $("stRam");
    ram.textContent = mb >= 1024 ? (mb / 1024).toFixed(1) + " GB" : mb + " MB"; ram.classList.toggle("hot", mb > 3072);
    const u = st.upS, h = Math.floor(u / 3600), m = Math.floor(u % 3600 / 60), sec = u % 60;
    $("stUp").textContent = h + ":" + String(m).padStart(2, "0") + ":" + String(sec).padStart(2, "0");
  }
  async function pingTick() {
    const t = now(), el = $("stPing");
    if (!t || !/^https?:/.test(t.url)) { el.textContent = "--"; el.className = ""; return; }
    const ms = await B.ping(t.url).catch(() => null);
    el.textContent = ms == null ? "--" : ms + "ms"; el.className = ms == null ? "" : ms < 80 ? "good" : ms > 250 ? "hot" : "";
  }
  $("stRamBox").onclick = sleepAllNow;
  statsTick(); setInterval(statsTick, 1000); setTimeout(pingTick, 2500); setInterval(pingTick, 10000);

  /* ---------- tab switch: tear lines (a quick red glitch, about a third of a second) ---------- */
  let glitchOn = store.get("glitch", true);
  function tear(el) {
    if (!glitchOn || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const box = $("tear"); box.replaceChildren();
    for (let k = 0; k < 5; k++) { const s = mk("span"); s.style.top = (Math.random() * 95) + "%"; s.style.height = (2 + Math.random() * 9) + "px"; s.style.animationDelay = (k * 30) + "ms"; box.append(s); }
    clearTimeout(tear.t); tear.t = setTimeout(() => box.replaceChildren(), 520);
    if (el) { el.classList.remove("tearin"); void el.offsetWidth; el.classList.add("tearin"); setTimeout(() => el.classList.remove("tearin"), 420); }
  }
  $("sGlitch").setAttribute("aria-checked", glitchOn);
  $("sGlitch").onclick = () => { glitchOn = !glitchOn; store.set("glitch", glitchOn); $("sGlitch").setAttribute("aria-checked", glitchOn); if (glitchOn) tear(now() ? now().wv : $("start")); };

  /* ---------- mute a tab ---------- */
  function muteTab(t) { t.muted = !t.muted; try { t.wv && t.wv.setAudioMuted(t.muted); } catch {} renderTabs(); miniTick(); toast(t.muted ? "Tab muted" : "Tab unmuted"); }

  /* ---------- split view: two tabs side by side; drag the bar in the middle to resize ---------- */
  let split = null;   // { a, b, r }
  function inSplit(id) { return !!split && id != null && (split.a === id || split.b === id); }
  function splitShown() { return !!split && inSplit(cur) && tabs.some(t => t.id === split.a) && tabs.some(t => t.id === split.b); }
  function splitStart(a, b) { split = { a, b, r: store.get("splitR", .5) }; const o = tabs.find(t => t.id === b); if (o) { o.asleep = false; o.bgPaused = false; } select(a); toast("Split view. Drag the middle bar to resize"); }
  function splitEnd() { split = null; layoutSplit(); renderTabs(); }
  function layoutSplit() {
    const on = splitShown();
    document.body.classList.toggle("splitting", on);
    tabs.forEach(t => { if (t.wv) { t.wv.style.left = ""; t.wv.style.width = ""; t.wv.classList.remove("pane", "focus"); } });
    $("splitBar").hidden = !on;
    if (!on) return;
    const A = tabs.find(t => t.id === split.a), Z = tabs.find(t => t.id === split.b);
    for (const t of [A, Z]) { if (t.url && !t.wv) { const r = resumeUrl(t); if (r !== t.url) t.url = r; makeView(t); } t.asleep = false; t.seen = Date.now(); }
    const r = split.r;
    A.wv.classList.remove("off"); Z.wv.classList.remove("off");
    A.wv.style.left = "0"; A.wv.style.width = `calc(${r * 100}% - 3px)`;
    Z.wv.style.left = `calc(${r * 100}% + 3px)`; Z.wv.style.width = `calc(${(1 - r) * 100}% - 3px)`;
    A.wv.classList.add("pane"); Z.wv.classList.add("pane");
    (cur === A.id ? A : Z).wv.classList.add("focus");
    $("splitBar").style.left = `calc(${r * 100}% - 3px)`;
  }
  $("splitBar").addEventListener("pointerdown", e => {
    e.preventDefault(); const bar = $("splitBar"); bar.setPointerCapture(e.pointerId); document.body.classList.add("dragsplit");
    const rect = $("view").getBoundingClientRect();
    const mv = ev => { if (!split) return; split.r = Math.max(.2, Math.min(.8, (ev.clientX - rect.left) / rect.width)); layoutSplit(); };
    const up = () => { bar.removeEventListener("pointermove", mv); document.body.classList.remove("dragsplit"); if (split) store.set("splitR", split.r); };
    bar.addEventListener("pointermove", mv); bar.addEventListener("pointerup", up, { once: true }); bar.addEventListener("pointercancel", up, { once: true });
  });
  $("splitBar").ondblclick = () => { if (split) { split.r = .5; store.set("splitR", .5); layoutSplit(); } };
  $("splitX").onclick = e => { e.stopPropagation(); splitEnd(); };

  /* ---------- mini player: a video or song playing (or paused) in a tab you've left ---------- */
  const MINI_JS = `(() => { const vs = [...document.querySelectorAll("video, audio")]; const v = vs.find(x => !x.paused && !x.ended) || vs.find(x => x.dataset.sbPaused) || vs.find(x => x.currentTime > 1 && !x.ended); if (!v) return { has: false }; return { has: true, paused: v.paused, cur: v.currentTime || 0, dur: isFinite(v.duration) ? v.duration : 0, yt: !!document.querySelector(".ytp-next-button") }; })()`;
  const miniDo = (t, js) => { try { t.wv.executeJavaScript(`(() => { const vs = [...document.querySelectorAll("video, audio")]; const v = vs.find(x => !x.paused && !x.ended) || vs.find(x => x.dataset.sbPaused) || vs.find(x => x.currentTime > 1) || vs[0]; if (!v) return; ${js} })()`, true).then(() => setTimeout(miniTick, 150)).catch(() => {}); } catch {} };
  const ytId = u => { try { const x = new URL(u); if (/youtu\.be$/.test(x.hostname)) return x.pathname.slice(1); return x.searchParams.get("v") || (x.pathname.match(/^\/(shorts|live)\/([\w-]+)/) || [])[2] || ""; } catch { return ""; } };
  const fmt = s => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = String(s % 60).padStart(2, "0"); return h ? h + ":" + String(m).padStart(2, "0") + ":" + x : m + ":" + x; };
  let miniT = null, miniBusy = false;
  function miniPick() {
    const shown = new Set([cur]); if (splitShown()) { shown.add(split.a); shown.add(split.b); }
    return tabs.filter(t => t.wv && !shown.has(t.id) && !t.miniX && (t.audible || t.bgPaused)).sort((x, y) => (y.audible - x.audible) || ((y.seen || 0) - (x.seen || 0)))[0] || null;
  }
  async function miniTick() {
    if (miniBusy) return; miniBusy = true;
    try {
      const t = miniPick();
      if (!t) { $("mini").hidden = true; miniT = null; return; }
      const st = await t.wv.executeJavaScript(MINI_JS).catch(() => null);
      if (!st || !st.has) { t.bgPaused = false; if (!t.audible) { $("mini").hidden = true; miniT = null; } return; }
      if (miniT !== t.id) {
        miniT = t.id; const id = ytId(t.url);
        const im = $("miniImg"); im.onerror = () => { im.onerror = () => { im.onerror = null; im.src = "assets/blackwall.png"; }; im.classList.add("ico"); im.src = id && t.icon ? t.icon : "assets/blackwall.png"; };
        im.classList.toggle("ico", !id); im.src = id ? "https://i.ytimg.com/vi/" + id + "/mqdefault.jpg" : (t.icon || favi(t.url) || "assets/blackwall.png");
      }
      $("miniT").textContent = (t.title || host(t.url)).replace(/ - YouTube$/, "");
      $("miniS").textContent = host(t.url) + (st.dur ? " · " + fmt(st.cur) + " / " + fmt(st.dur) : "");
      $("miniBar").style.width = st.dur ? Math.min(100, st.cur / st.dur * 100) + "%" : "0";
      $("miniPlayI").innerHTML = st.paused ? '<path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/>' : '<path d="M8 5v14M16 5v14"/>';
      $("miniPlay").setAttribute("aria-label", st.paused ? "Play" : "Pause");
      $("miniNext").title = st.yt ? "Next video" : "Forward 10 seconds";
      $("miniMute").innerHTML = t.muted ? ICON_MUTE : ICON_SND; $("miniMute").title = t.muted ? "Unmute" : "Mute";
      $("mini").hidden = false;
    } finally { miniBusy = false; }
  }
  const miniTab = () => tabs.find(t => t.id === miniT);
  $("miniPlay").onclick = () => { const t = miniTab(); if (t) miniDo(t, `delete v.dataset.sbPaused; if (v.paused) v.play().catch(() => {}); else v.pause();`); };
  $("miniBack").onclick = () => { const t = miniTab(); if (t) miniDo(t, `v.currentTime = Math.max(0, v.currentTime - 10);`); };
  $("miniNext").onclick = () => { const t = miniTab(); if (t) miniDo(t, `const n = document.querySelector(".ytp-next-button"); if (n && n.offsetParent !== null) n.click(); else v.currentTime = Math.min(v.duration || 1e9, v.currentTime + 10);`); };
  $("miniMute").onclick = () => { const t = miniTab(); if (t) muteTab(t); };
  $("miniGo").onclick = () => { const t = miniTab(); if (t) select(t.id); };
  $("miniX").onclick = () => { const t = miniTab(); if (t) { t.miniX = true; miniDo(t, `v.pause();`); } $("mini").hidden = true; miniT = null; };
  setInterval(miniTick, 1000);

  /* ---------- shield: what was blocked on this page ---------- */
  async function shRender() {
    const t = now(), box = $("shList"); box.replaceChildren();
    $("shSite").textContent = t && t.url ? host(t.url) : "Home";
    $("shT").textContent = t ? (t.trackers || 0) : 0; $("shA").textContent = t ? Math.max(0, (t.blocked || 0) - (t.trackers || 0)) : 0;
    const info = t && t.url ? await B.siteGet(t.url).catch(() => null) : null;
    $("shOnRow").hidden = !info; if (info) $("shOn").setAttribute("aria-checked", info.shield && cfg.adBlock);
    $("shNote").textContent = !cfg.adBlock ? "Ad and tracker blocking is off everywhere (Settings)." : info && !info.shield ? "The shield is off for this site." : "Known ad and tracker servers are stopped before they load.";
    const rows = Object.entries((t && t.hosts) || {}).sort((x, y) => y[1].n - x[1].n);
    if (!rows.length) { box.append(mk("div", "empty", t && t.url ? "Nothing blocked on this page yet." : "Open a page to see what gets blocked.")); return; }
    for (const [h, v] of rows.slice(0, 40)) { const r = mk("div", "shr"); r.append(mk("span", "tag" + (v.tr ? " tr" : ""), v.tr ? "Tracker" : "Ad"), mk("span", "h", h), mk("b", "", String(v.n))); box.append(r); }
  }
  $("shOn").onclick = async () => {
    const t = now(); if (!t || !t.url) return;
    if (!cfg.adBlock) { cfg = await B.setCfg({ adBlock: true }) || cfg; }
    const info = await B.siteGet(t.url); await B.siteSet({ url: t.url, key: "shield", val: !info.shield });
    toast(!info.shield ? "Shield on for " + host(t.url) : "Shield off for " + host(t.url) + ". Reloading");
    try { t.wv && t.wv.reload(); } catch {} shRender(); paintBar();
  };
  $("shSet").onclick = () => { togglePop("setPop"); paintSettings(); };

  /* ---------- this site: permissions, pop-ups, its cookies ---------- */
  const PERM_NAMES = { camera: "Camera", mic: "Microphone", location: "Location", notifications: "Notifications" };
  async function siteRender() {
    const t = now(); if (!t || !t.url) { $("sitePop").hidden = true; return; }
    const secure = /^https:/.test(t.url);
    $("siHost").textContent = host(t.url) || t.url;
    $("siSec").textContent = secure ? "Connection is secure" : "Connection isn't secure: don't enter passwords or card details here";
    $("siSec").classList.toggle("bad", !secure);
    const info = await B.siteGet(t.url).catch(() => null);
    const box = $("siPerms"); box.replaceChildren();
    if (!info) return;
    for (const k of Object.keys(PERM_NAMES)) {
      const r = mk("div", "set"); const tx = mk("div", "tx"); tx.append(mk("b", "", PERM_NAMES[k])); r.append(tx);
      const s = mk("select"); s.setAttribute("aria-label", PERM_NAMES[k]);
      for (const [v, l] of [["ask", "Ask"], ["allow", "Allow"], ["block", "Block"]]) { const o = mk("option", "", l); o.value = v; s.append(o); }
      s.value = info.perms[k]; s.onchange = async () => { await B.siteSet({ url: t.url, key: k, val: s.value }); toast(PERM_NAMES[k] + ": " + s.options[s.selectedIndex].text + ". Reload the page if it's open"); };
      r.append(s); box.append(r);
    }
    $("siPop").setAttribute("aria-checked", !info.popups);
  }
  $("siPop").onclick = async () => { const t = now(); if (!t) return; const info = await B.siteGet(t.url); await B.siteSet({ url: t.url, key: "popups", val: !info.popups }); siteRender(); toast(info.popups ? "Pop-ups allowed on " + host(t.url) : "Pop-ups blocked on " + host(t.url)); };
  $("siClear").onclick = async () => { const t = now(); if (!t) return; $("siClear").disabled = true; await B.siteClear(t.url); $("siClear").disabled = false; toast("Cookies and data cleared for " + host(t.url) + ". Reloading"); try { t.wv && t.wv.reload(); } catch {} };
  // a site asking for the camera, mic, location or notifications
  const permQ = [];
  function permShow() {
    const d = permQ[0]; if (!d) { $("permNote").hidden = true; return; }
    const what = d.kinds.map(k => PERM_NAMES[k].toLowerCase()).join(" and ");
    $("permTx").textContent = d.site + " wants to use your " + what; $("permNote").hidden = false;
  }
  const permReply = allow => { const d = permQ.shift(); if (d) B.permAnswer({ id: d.id, allow, remember: true }); permShow(); };
  B.onPerm(d => { permQ.push(d); permShow(); });
  $("permY").onclick = () => permReply(true); $("permN").onclick = () => permReply(false);

  /* ---------- sessions: save a set of tabs by name and open them again in one click ---------- */
  let sessions = store.get("sessions", []); if (!Array.isArray(sessions)) sessions = [];
  const sesSave = () => store.set("sessions", sessions);
  const sesSnap = () => { const tl = tabs.filter(t => t.url); return { tabs: tl.map(t => ({ url: resumeUrl(t), title: t.title || "", g: t.g || 0 })), groups: groups.filter(g => tl.some(t => t.g === g.id)).map(g => ({ id: g.id, name: g.name, color: g.color, collapsed: false })), at: Date.now() }; };
  function sesRender() {
    const box = $("sesList"); box.replaceChildren();
    if (!sessions.length) { box.append(mk("div", "empty", "Save the tabs you have open as a session, then open them all again from here.")); return; }
    for (const s of sessions) {
      const r = mk("div", "ses"); const b = mk("button", "ses-o"); b.type = "button";
      const ic = mk("div", "ses-i"); (s.tabs || []).slice(0, 3).forEach(x => { const im = mk("img"); im.alt = ""; im.src = favi(x.url); im.onerror = () => im.remove(); ic.append(im); });
      const tx = mk("div", "tx"); tx.append(mk("b", "", s.name), mk("span", "", (s.tabs || []).length + " tab" + ((s.tabs || []).length === 1 ? "" : "s") + " · " + new Date(s.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })));
      b.append(ic, tx); b.title = (s.tabs || []).map(x => x.title || host(x.url)).join("\n"); b.onclick = () => { closePops(); sesOpen(s, false); };
      const more = mk("button", "ib"); more.type = "button"; more.setAttribute("aria-label", "Session options"); more.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5.5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18.5" cy="12" r="1.7"/></svg>';
      more.onclick = e => { e.stopPropagation(); const rc = more.getBoundingClientRect(); menuAt(rc.left - 150, rc.bottom + 4, 0, [
        { label: "Open in new tabs", act: () => { closePops(); sesOpen(s, false); } },
        { label: "Replace my tabs with this", act: () => { closePops(); sesOpen(s, true); } },
        "-",
        { label: "Update with my open tabs", act: () => { const n = sesSnap(); if (!n.tabs.length) return toast("No tabs open"); Object.assign(s, n); sesSave(); sesRender(); toast("Session " + s.name + " updated"); } },
        { label: "Rename", act: async () => { const n = await window.__askAsync("Session name", s.name); if (n != null && n.trim()) { s.name = n.trim().slice(0, 40); sesSave(); sesRender(); } } },
        { label: "Delete", act: () => { sessions = sessions.filter(x => x !== s); sesSave(); sesRender(); toast("Session deleted"); } }
      ]); };
      r.append(b, more); box.append(r);
    }
  }
  $("sesNew").onclick = async () => {
    const n = sesSnap(); if (!n.tabs.length) return toast("Open some tabs first");
    const name = await window.__askAsync("Name this session", "");
    if (name == null) return;
    sessions.unshift(Object.assign({ id: Date.now(), name: name.trim().slice(0, 40) || "Session " + (sessions.length + 1) }, n)); sesSave(); sesRender();
    toast("Saved " + n.tabs.length + " tab" + (n.tabs.length === 1 ? "" : "s") + " as " + sessions[0].name);
  };
  function sesOpen(s, replace) {
    if (!s.tabs || !s.tabs.length) return;
    if (replace) { split = null; tabs.slice().forEach(t => { if (t.wv) t.wv.remove(); }); tabs.splice(0); groups = []; }
    const gmap = {}; for (const g of s.groups || []) { const ng = { id: Date.now() + Math.floor(Math.random() * 1e6), name: g.name, color: g.color, collapsed: false }; gmap[g.id] = ng.id; groups.push(ng); }
    let first = null;
    for (const x of s.tabs) { const t = { id: ++seq, url: x.url, title: x.title || "", icon: "", loading: false, audible: false, wv: null, blocked: 0, wcId: 0, zoom: 1, g: gmap[x.g] || 0 }; tabs.push(t); if (!first) first = t; }
    groupTidy(); select(first.id);   // the others load when you open them
    toast("Opened " + s.name);
  }

  /* ---------- update pill ---------- */
  const updShow = () => { $("updBtn").hidden = false; };
  B.onUpd(updShow);
  B.updGet().then(u => { if (u && u.state === "ready") updShow(); if (u && u.version) $("verT").textContent = "v" + u.version; }).catch(() => {});
  $("updBtn").onclick = () => { save(); B.restart(); };

  /* ---------- start ---------- */
  bmRender();
  const saved = store.get("tabs", null);
  const list = saved && Array.isArray(saved.list) ? saved.list.filter(x => x && /^https?:\/\//i.test(x.url)) : [];
  if (list.length) {
    list.forEach(x => tabs.push({ id: ++seq, url: x.url, title: x.title || "", icon: "", loading: false, audible: false, wv: null, blocked: 0, wcId: 0, zoom: 1, g: groups.some(gr => gr.id === x.g) ? x.g : 0 }));
    if (saved.cur === -1) goHome(); else select(tabs[Math.min(Math.max(0, saved.cur | 0), tabs.length - 1)].id);   // the other tabs load when you open them
  } else goHome();
  // opened from a link in another app (when Blackwall is your default browser)
  B.startUrl().then(u => { if (u) newTab(u); }).catch(() => {});
  setInterval(() => { if (now() && now().wv) paintBar(); }, 1500);
})();
