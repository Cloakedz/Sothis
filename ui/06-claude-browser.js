  /* ---------- Claude (claude.ai inside Sothis, with its own sign-in) ---------- */
  let cl = null;
  function ensureClaude() {
    if (cl) return;
    cl = document.createElement("webview");
    cl.setAttribute("partition", "persist:claude");
    cl.setAttribute("allowpopups", "");
    cl.setAttribute("src", "https://claude.ai/");
    $("clWrap").append(cl);
    cl.addEventListener("did-start-loading", () => $("clLoad").classList.add("on"));
    cl.addEventListener("did-stop-loading", () => $("clLoad").classList.remove("on"));
  }

  /* ---------- Browser tab: tabs, address bar, start page ---------- */
  const WB_QUICK = [["Google", "https://www.google.com/"], ["YouTube", "https://www.youtube.com/"], ["Twitch", "https://www.twitch.tv/"], ["Reddit", "https://www.reddit.com/"], ["Gmail", "https://mail.google.com/"], ["GitHub", "https://github.com/"], ["Modrinth", "https://modrinth.com/"], ["Wikipedia", "https://en.wikipedia.org/"]];
  const WB_GLOBE = '<svg class="wb-gl" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>';
  // pages inside the browser use Sothis's own fullscreen (real fullscreen freezes the see-through window)
  const WB_FS = `(() => { if (window.__sothisFs) return; window.__sothisFs = 1; let el = null, old = null;
    const ev = () => { document.dispatchEvent(new Event("fullscreenchange")); document.dispatchEvent(new Event("webkitfullscreenchange")); if (el) el.dispatchEvent(new Event("fullscreenchange", { bubbles: true })); };
    const out = () => { if (!el) return; if (old === null) el.removeAttribute("style"); else el.setAttribute("style", old); const e = el; el = null; document.documentElement.style.overflow = ""; e.dispatchEvent(new Event("fullscreenchange", { bubbles: true })); document.dispatchEvent(new Event("fullscreenchange")); console.log("SOTHIS:wfull:0"); };
    const req = function () { const t = this; if (el && el !== t) out(); el = t; old = t.getAttribute("style"); t.style.cssText += ";position:fixed!important;inset:0!important;left:0!important;top:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;margin:0!important;z-index:2147483647!important;background:#000;transform:none!important"; document.documentElement.style.overflow = "hidden"; ev(); console.log("SOTHIS:wfull:1"); return Promise.resolve(); };
    Element.prototype.requestFullscreen = req; Element.prototype.webkitRequestFullscreen = req; Element.prototype.webkitRequestFullScreen = req;
    document.exitFullscreen = function () { out(); return Promise.resolve(); }; document.webkitExitFullscreen = document.webkitCancelFullScreen = document.exitFullscreen;
    for (const k of ["fullscreenElement", "webkitFullscreenElement", "webkitCurrentFullScreenElement"]) Object.defineProperty(document, k, { configurable: true, get: () => el });
    Object.defineProperty(document, "fullscreenEnabled", { configurable: true, get: () => true });
    window.addEventListener("keydown", e => { if (e.key === "Escape" && el) { e.preventDefault(); out(); } }, true);
  })();`;
  let wbTabs = [], wbCur = null, wbSeq = 0, wbClosed = [];
  const wbTab = id => wbTabs.find(t => t.id === id);
  const wbNow = () => wbTab(wbCur);
  function wbParse(q) {
    q = String(q || "").trim(); if (!q) return "";
    if (/^https?:\/\//i.test(q)) return q;
    if (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/|$)/i.test(q)) return "http://" + q;
    if (!/\s/.test(q) && /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(q)) return "https://" + q;
    return "https://www.google.com/search?q=" + encodeURIComponent(q);
  }
  function wbSave() {
    const list = wbTabs.filter(t => t.url).slice(0, 15).map(t => ({ url: t.url, title: t.title || "" }));
    try { store.set("web.tabs", JSON.stringify({ list, cur: Math.max(0, wbTabs.filter(t => t.url).indexOf(wbNow())) })); } catch {}
  }
  function wbView(t) {
    const wv = document.createElement("webview");
    wv.setAttribute("partition", "persist:browser");
    wv.setAttribute("allowpopups", "");
    wv.setAttribute("src", t.url);
    t.wv = wv; t.ready = false;
    const mine = () => t.id === wbCur;
    wv.addEventListener("did-start-loading", () => { t.loading = true; if (mine()) wbBar(); });
    wv.addEventListener("did-stop-loading", () => { t.loading = false; if (mine()) wbBar(); });
    wv.addEventListener("dom-ready", () => { try { t.wcId = wv.getWebContentsId(); } catch {} t.ready = true; wv.executeJavaScript(WB_FS).catch(() => {}); if (mine()) wbBar(); });
    wv.addEventListener("page-title-updated", e => { t.title = e.title; wbRenderTabs(); wbSave(); });
    wv.addEventListener("page-favicon-updated", e => { t.icon = (e.favicons || [])[0] || ""; wbRenderTabs(); });
    const nav = e => { if (e.isMainFrame === false) return; t.url = e.url; if (mine()) wbBar(); wbSave(); };
    wv.addEventListener("did-navigate", e => { t.icon = ""; t.blockBase = (t.blockBase || 0) + (t.blocked || 0); t.blocked = 0; nav(e); if (mine()) wbShieldPaint(); });
    wv.addEventListener("did-navigate-in-page", nav);
    wv.addEventListener("media-started-playing", () => { t.audible = true; wbRenderTabs(); });
    wv.addEventListener("media-paused", () => { t.audible = false; wbRenderTabs(); });
    wv.addEventListener("console-message", e => { const m = /^SOTHIS:wfull:(\d)$/.exec(e.message || ""); if (m && mine()) wbFull(m[1] === "1"); });
    $("wbWrap").append(wv);
  }
  function wbRenderTabs() {
    const box = $("wbTabs"), nb = $("wbNew");
    box.querySelectorAll(".wb-tab").forEach(x => x.remove());
    wbTabs.forEach(t => {
      const b = mk("button", "wb-tab" + (t.audible ? " audible" : "")); b.type = "button"; b.setAttribute("role", "tab"); b.setAttribute("aria-selected", t.id === wbCur);
      const name = t.title || (t.url ? t.url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0] : "New tab");
      b.title = name;
      if (t.icon) { const im = mk("img"); im.alt = ""; im.src = t.icon; im.onerror = () => { t.icon = ""; im.replaceWith(document.createRange().createContextualFragment(WB_GLOBE)); }; b.append(im); }
      else b.insertAdjacentHTML("beforeend", WB_GLOBE);
      b.append(mk("b", "", name));
      const x = mk("span", "wb-x"); x.setAttribute("role", "button"); x.setAttribute("aria-label", "Close " + name); x.title = "Close (Ctrl+W)";
      x.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
      x.onclick = e => { e.stopPropagation(); wbClose(t.id); };
      b.append(x);
      b.onclick = () => wbSelect(t.id);
      b.onauxclick = e => { if (e.button === 1) { e.preventDefault(); wbClose(t.id); } };
      box.insertBefore(b, nb);
    });
  }
  function wbBar() {
    const t = wbNow(); if (!t) return;
    const wv = t.wv, ok = wv && t.ready;
    let back = false, fwd = false; try { if (ok) { back = wv.canGoBack(); fwd = wv.canGoForward(); } } catch {}
    $("wbBack").disabled = !back; $("wbFwd").disabled = !fwd; $("wbReload").disabled = !wv; $("wbExt").disabled = !t.url;
    $("wbReloadI").setAttribute("d", t.loading ? "M6 6l12 12M18 6 6 18" : "M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6");
    $("wbReload").setAttribute("aria-label", t.loading ? "Stop" : "Reload");
    $("wbLoad").classList.toggle("on", !!t.loading);
    if (document.activeElement !== $("wbUrl")) $("wbUrl").value = t.url || "";
    $("wbLock").hidden = !/^https:/i.test(t.url || "");
    $("wbStart").hidden = !!t.url;
    try { wbShieldPaint(); } catch {}
  }
  function wbSelect(id) {
    const t = wbTab(id); if (!t) return;
    if (t.lazy) { t.lazy = false; wbView(t); }   // tabs restored from last time load when you first open them
    wbCur = id;
    wbTabs.forEach(x => { if (x.wv) x.wv.classList.toggle("wb-off", x.id !== id); });
    wbRenderTabs(); wbBar(); wbSave();
    const el = $("wbTabs").querySelector('.wb-tab[aria-selected="true"]'); if (el) el.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (!t.url) setTimeout(() => $("wbSq").focus(), 30);
  }
  function wbNewTab(url, bg) {
    const t = { id: ++wbSeq, url: url || "", title: "", icon: "", wv: null };
    const i = wbTabs.indexOf(wbNow());
    wbTabs.splice(i < 0 ? wbTabs.length : i + 1, 0, t);
    if (t.url) wbView(t);
    if (bg) { if (t.wv) t.wv.classList.add("wb-off"); wbRenderTabs(); wbSave(); toast("Opened in a new tab"); }
    else wbSelect(t.id);
    return t;
  }
  function wbClose(id) {
    const i = wbTabs.findIndex(t => t.id === id); if (i < 0) return;
    const [t] = wbTabs.splice(i, 1);
    if (t.url) { wbClosed.push(t.url); if (wbClosed.length > 20) wbClosed.shift(); }
    if (t.wv) t.wv.remove();
    if (!wbTabs.length) { wbNewTab(""); return; }
    if (wbCur === id) wbSelect(wbTabs[Math.min(i, wbTabs.length - 1)].id); else { wbRenderTabs(); wbSave(); }
  }
  function wbGo(q) {
    const url = wbParse(q); if (!url) return;
    let t = wbNow(); if (!t) t = wbNewTab("");
    t.url = url; t.title = ""; t.icon = "";
    if (t.wv) t.wv.loadURL(url).catch(() => {}); else wbView(t);
    wbSelect(t.id);
    try { t.wv.focus(); } catch {}
  }
  // start-page shortcuts: yours to change (hover a shortcut and press × to remove it, + to add one)
  const WB_QUICK_DEF = WB_QUICK.map(([n, u]) => ({ n, u }));
  let wbQuick = null; try { wbQuick = JSON.parse(store.get("web.quick") || "null"); } catch {}
  if (!Array.isArray(wbQuick)) wbQuick = WB_QUICK_DEF.slice();
  const wbQuickSave = () => store.set("web.quick", JSON.stringify(wbQuick));
  function wbQuickRender() {
    const box = $("wbQuick"); box.replaceChildren();
    wbQuick.forEach((q, i) => {
      const b = mk("button", "wb-q"); b.type = "button"; b.title = q.u;
      const ic = mk("i", "", (q.n || "?")[0].toUpperCase());
      try { const im = mk("img"); im.alt = ""; im.src = "https://www.google.com/s2/favicons?sz=64&domain=" + new URL(q.u).hostname; im.onload = () => { ic.textContent = ""; ic.append(im); }; } catch {}
      const x = mk("span", "wb-qx"); x.setAttribute("role", "button"); x.setAttribute("aria-label", "Remove " + q.n); x.title = "Remove shortcut"; x.textContent = "×";
      x.onclick = e => { e.stopPropagation(); wbQuick.splice(i, 1); wbQuickSave(); wbQuickRender(); };
      b.append(x, ic, document.createTextNode(q.n)); b.onclick = () => wbGo(q.u); box.append(b);
    });
    const add = mk("button", "wb-q wb-qadd"); add.type = "button"; add.append(mk("i", "", "+"), document.createTextNode("Add"));
    add.onclick = () => { $("wbQform").hidden = false; const t = wbNow(); $("wbQname").value = ""; $("wbQurl").value = t && t.url ? t.url : ""; $("wbQname").focus(); };
    box.append(add);
    $("wbQreset").hidden = JSON.stringify(wbQuick) === JSON.stringify(WB_QUICK_DEF);
  }
  $("wbQform").onsubmit = e => {
    e.preventDefault();
    const n = $("wbQname").value.trim().slice(0, 20), u = wbParse($("wbQurl").value);
    if (!n || !u || /google\.com\/search/.test(u) && !/google\.com\/search/.test($("wbQurl").value)) { toast("Give it a name and a web address"); return; }
    wbQuick.push({ n, u }); wbQuickSave(); $("wbQform").hidden = true; wbQuickRender();
  };
  $("wbQcancel").onclick = () => { $("wbQform").hidden = true; };
  $("wbQreset").onclick = () => { wbQuick = WB_QUICK_DEF.slice(); wbQuickSave(); wbQuickRender(); };
  // Ad & pop-up blocking (done by Sothis itself for the browser tab)
  let wbBlock = { ads: true, pops: true }, wbPopLast = null;
  const wbShieldPaint = () => {
    const t = wbNow(), n = t ? (t.blocked || 0) : 0;
    $("wbShield").classList.toggle("on", wbBlock.ads);
    $("wbShieldN").textContent = wbBlock.ads && n ? String(n > 999 ? "999+" : n) : "";
    $("wbShield").title = wbBlock.ads ? (n ? n + " ads and trackers blocked on this tab" : "Ad blocking is on") : "Ad blocking is off";
    $("wbBlkAds").setAttribute("aria-checked", wbBlock.ads); $("wbBlkPops").setAttribute("aria-checked", wbBlock.pops);
    $("wbBlkN").textContent = wbBlock.ads ? (n ? n + " blocked on this tab so far." : "Stops ads and trackers from loading.") : "Ads load normally.";
  };
  D.webBlockCfg().then(c => { if (c) wbBlock = c; wbShieldPaint(); }).catch(() => {});
  $("wbShield").onclick = () => { const open = $("wbBlk").hidden; $("wbBlk").hidden = !open; $("wbShield").setAttribute("aria-expanded", open); wbShieldPaint(); };
  $("wbBlkAds").onclick = async () => { wbBlock = await D.webBlockCfg({ ads: !wbBlock.ads }); wbShieldPaint(); toast(wbBlock.ads ? "Ad blocking on. Reload the page to clear ads already shown" : "Ad blocking off"); };
  $("wbBlkPops").onclick = async () => { wbBlock = await D.webBlockCfg({ pops: !wbBlock.pops }); wbShieldPaint(); };
  D.onWebBlocked(d => { const t = wbTabs.find(x => x.wcId === d.id); if (t) { t.blocked = d.n - (t.blockBase || 0); if (t.id === wbCur) wbShieldPaint(); } });
  D.onWebPopup(d => {
    const t = wbTabs.find(x => x.wcId === d.from); if (!t || t.id !== wbCur) return;
    wbPopLast = d.url; $("wbPopUrl").textContent = d.url.replace(/^https?:\/\//, "").slice(0, 80); $("wbPopNote").hidden = false;
    clearTimeout(wbPopLast.t); setTimeout(() => { if (wbPopLast === d.url) $("wbPopNote").hidden = true; }, 12000);
  });
  $("wbPopOpen").onclick = () => { if (wbPopLast) wbNewTab(wbPopLast); $("wbPopNote").hidden = true; };
  $("wbPopX").onclick = () => { $("wbPopNote").hidden = true; };
  function wbEnsure() {
    if (wbTabs.length) { wbBar(); return; }
    wbQuickRender();
    let saved = null; try { saved = JSON.parse(store.get("web.tabs") || "null"); } catch {}
    const list = saved && Array.isArray(saved.list) ? saved.list.filter(x => x && /^https?:\/\//i.test(x.url)) : [];
    if (!list.length) { wbNewTab(""); return; }
    // tabs come back as you left them; pages load when you open each one
    list.forEach(x => wbTabs.push({ id: ++wbSeq, url: x.url, title: x.title || "", icon: "", wv: null, lazy: true }));
    const first = wbTabs[Math.min(Math.max(0, saved.cur | 0), wbTabs.length - 1)];
    wbSelect(first.id);
  }
  function wbFull(on) {
    document.body.classList.toggle("wb-full", !!on);
    D.fullscreen(!!on);
  }
  $("wbUnfull").onclick = () => { const t = wbNow(); if (t && t.wv) t.wv.executeJavaScript("document.exitFullscreen && document.exitFullscreen()").catch(() => {}); wbFull(false); };
  $("wbNew").onclick = () => wbNewTab("");
  $("wbBack").onclick = () => { const t = wbNow(); try { if (t && t.wv && t.wv.canGoBack()) t.wv.goBack(); } catch {} };
  $("wbFwd").onclick = () => { const t = wbNow(); try { if (t && t.wv && t.wv.canGoForward()) t.wv.goForward(); } catch {} };
  $("wbReload").onclick = () => { const t = wbNow(); if (!t || !t.wv) return; try { if (t.loading) t.wv.stop(); else t.wv.reload(); } catch {} };
  $("wbExt").onclick = () => { const t = wbNow(); if (t && t.url) D.openExternal(t.url); };
  $("wbBar").onsubmit = e => { e.preventDefault(); const v = $("wbUrl").value; $("wbUrl").blur(); wbGo(v); };
  $("wbUrl").addEventListener("focus", () => setTimeout(() => $("wbUrl").select(), 0));
  $("wbUrl").addEventListener("keydown", e => { if (e.key === "Escape") { $("wbUrl").blur(); wbBar(); } });
  $("wbSf").onsubmit = e => { e.preventDefault(); const v = $("wbSq").value; $("wbSq").value = ""; wbGo(v); };
  function wbKey(k) {
    if (tab !== "web") return false;
    const t = wbNow();
    if (k === "ctrl+t") { wbNewTab(""); }
    else if (k === "ctrl+shift+t") { const u = wbClosed.pop(); if (u) wbNewTab(u); }
    else if (k === "ctrl+w") { if (t) wbClose(t.id); }
    else if (k === "ctrl+l") { if (t && !t.url) $("wbSq").focus(); else { $("wbUrl").focus(); $("wbUrl").select(); } }
    else if (k === "ctrl+r" || k === "f5") { if (t && t.wv) try { t.wv.reload(); } catch {} }
    else if (k === "alt+arrowleft") $("wbBack").click();
    else if (k === "alt+arrowright") $("wbFwd").click();
    else if (k === "ctrl+tab" || k === "ctrl+shift+tab") { const i = wbTabs.indexOf(t), n = wbTabs.length; if (n > 1) wbSelect(wbTabs[(i + (k === "ctrl+tab" ? 1 : -1) + n) % n].id); }
    else return false;
    return true;
  }
  D.onWebKey(k => wbKey(k));
  document.addEventListener("keydown", e => {
    if (tab !== "web") return;
    const k = (e.key || "").toLowerCase(), c = e.ctrlKey || e.metaKey;
    const combo = c && !e.altKey && ["t", "w", "l", "r", "tab"].includes(k) ? (e.shiftKey && k === "tab" ? "ctrl+shift+tab" : e.shiftKey && k === "t" ? "ctrl+shift+t" : "ctrl+" + k) : k === "f5" ? "f5" : e.altKey && !c && (k === "arrowleft" || k === "arrowright") ? "alt+" + k : null;
    if (!combo) return;
    if ((combo === "alt+arrowleft" || combo === "alt+arrowright") && e.target.matches("input, textarea")) return;
    if (wbKey(combo)) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  D.onWebOpen(d => { if (!d || !d.url) return; if (!wbTabs.length) wbEnsure(); wbNewTab(d.url, !!d.bg && tab === "web"); if (tab !== "web") showTab("web"); });
  D.onWebDl(d => { if (!d) return; if (d.state === "start") toast("Downloading " + d.name); else if (d.state === "completed") toast("Saved to Downloads: " + d.name); else if (d.state !== "cancelled") toast("Download failed: " + d.name); });

  /* Discord extras: call timer, per-person volume, pinned channels, leave, mentions inside Sothis */
  let dcSince = 0, dcVolFor = null, dcVolT = null;
  let dcPins = []; try { dcPins = JSON.parse(store.get("dc.pins") || "[]") || []; } catch {}
  function dcTimer() {
    if (!dcSince || $("hmDc").hidden) return;
    const s = Math.max(0, Math.floor((Date.now() - dcSince) / 1000)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60;
    $("hmDcTime").textContent = (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(sec).padStart(2, "0");
  }
  setInterval(dcTimer, 1000);
  function dcVolOpen(m) {
    dcVolFor = m.id;
    $("dcVol").hidden = false;
    $("dcVolAv").src = m.avatar; $("dcVolName").textContent = m.name;
    $("dcVolIn").value = m.vol; $("dcVolOut").textContent = m.vol + "%";
    $("dcVolMute").classList.toggle("on", !!m.localMute); $("dcVolMute").setAttribute("aria-pressed", !!m.localMute); $("dcVolMute").textContent = m.localMute ? "Muted for me" : "Mute for me";
    $("dcVolIn").focus();
  }
  function dcVolClose() { dcVolFor = null; $("dcVol").hidden = true; }
  $("dcVolX").onclick = dcVolClose;
  $("dcVolMute").onclick = () => {
    const id = dcVolFor, m = dcS && dcS.channel && dcS.channel.members.find(x => x.id === id);
    if (!m) return;
    D.dcUserMute(id, !m.localMute).then(st => { renderDc(st); const n = st && st.channel && st.channel.members.find(x => x.id === id); if (n) dcVolOpen(n); });
  };
  $("dcVolIn").addEventListener("input", () => {
    const v = +$("dcVolIn").value; $("dcVolOut").textContent = v + "%";
    clearTimeout(dcVolT); const id = dcVolFor;
    dcVolT = setTimeout(() => { if (id) D.dcUserVol(id, v).then(renderDc); }, 80);
  });
  $("dcVolIn").addEventListener("keydown", e => { if (e.key === "Escape") dcVolClose(); });
  const savePins = () => store.set("dc.pins", JSON.stringify(dcPins));
  $("hmDcPin").onclick = () => {
    const ch = dcS && dcS.channel; if (!ch) return;
    const i = dcPins.findIndex(p => p.id === ch.id);
    if (i >= 0) dcPins.splice(i, 1); else dcPins.push({ id: ch.id, name: ch.name, guild: ch.guild });
    savePins(); renderDc();
    toast(i >= 0 ? "Unpinned " + ch.name : "Pinned " + ch.name);
  };
  $("hmDcLeave").onclick = () => D.dcJoin(null).then(r => { if (!r.ok) toast("Couldn't leave: " + r.err); });
  const SPK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>';
  function renderPins() {
    const box = $("dcPins"); box.replaceChildren();
    const ok = dcS && dcS.status === "ok", here = ok && dcS.channel && dcS.channel.id;
    dcPins.forEach(p => {
      const b = mk("button", "dc-pin" + (p.id === here ? " here" : "")); b.type = "button";
      b.innerHTML = SPK; b.append(mk("span", "nm", p.name));
      b.title = "";
      b.setAttribute("aria-label", (p.id === here ? "In " : "Join ") + p.name + (p.guild ? " in " + p.guild : ""));
      const x = mk("span", "x"); x.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M7 7l10 10M17 7 7 17"/></svg>';
      x.onclick = e => { e.stopPropagation(); dcPins = dcPins.filter(q => q.id !== p.id); savePins(); renderPins(); renderDc(); };
      b.append(x);
      b.onclick = () => { if (!ok) return toast("Discord isn't connected"); if (p.id === here) return; D.dcJoin(p.id).then(r => toast(r.ok ? "Joining " + p.name : "Couldn't join: " + r.err)); };
      box.append(b);
    });
  }
  // Mentions and DMs: shown inside Sothis only
  D.onDcNotify(n => {
    note("discord", n.title || "Discord", n.body || "", n.icon || "");
    if (document.hidden) return;
    const stack = $("dcnStack");
    const c = mk("div", "dcn"), im = mk("img"); im.alt = ""; im.referrerPolicy = "no-referrer"; if (n.icon) im.src = n.icon;
    const tx = mk("div"); tx.append(mk("b", "", n.title || "Discord"), mk("span", "", n.body || ""));
    c.append(im, tx);
    const bye = () => { c.classList.add("out"); setTimeout(() => c.remove(), 260); };
    c.onclick = bye;
    stack.prepend(c);
    while (stack.children.length > 3) stack.lastChild.remove();
    setTimeout(bye, 7000);
  });

