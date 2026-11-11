  const $ = id => document.getElementById(id);
  const D = window.desktop;
  // Small message at the bottom of the window ("Saved", "Opening…")
  function toast(text) {
    const t = document.getElementById("toast"); if (!t) return;
    t.textContent = String(text || ""); t.classList.add("on");
    clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove("on"), Math.max(2400, String(text || "").length * 60));
  }
    const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} }
  };
  ["cider.host", "cider.token", "s.scope", "s.storefront"].forEach(k => { try { localStorage.removeItem(k); } catch {} });   // drop old Cider/Apple Music data
  // Every launch starts each page on its first view (Stats on the first game, Music on Library, Games on PC games,
  // Files on Clips, Settings on its first section...) instead of wherever it was left.
  ["st.game", "yt.view", "ytl.kind", "yts.kind", "gm.mode", "rel.kind", "rel.by", "fl.kind", "set.tab"].forEach(k => { try { localStorage.removeItem(k); } catch {} });

  /* ---------- Mini player (YouTube Music) ---------- */
  const PLAY = '<path d="M8 5v14l11-7z"/>', PAUSE = '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>';
  const M = {};
  ["mini", "mThumb", "mTitle", "mArtist", "mBar", "mFill", "mPrev", "mPlay", "mPlayIcon", "mNext"].forEach(id => M[id] = $(id));
  M.mPlay.onclick = () => ytCmd("playpause");
  M.mPrev.onclick = () => ytCmd("prev");
  M.mNext.onclick = () => ytCmd("next");
  M.mBar.addEventListener("click", e => { const r = M.mBar.getBoundingClientRect(); ytCmd("seek", (e.clientX - r.left) / r.width); });

  /* ---------- Views: Player / Stats tabs, Settings behind the gear ---------- */
  const TABS = ["home", "ytm", "games", "stats", "switch", "web", "opera", "claude"];
  let mainTab = "home";   // always open on Home
  let tab = mainTab;
  // the pink highlight under the selected tab, moved (not jumped) when you switch
  function tabPill() {
    const nav = document.querySelector(".tabs"); if (!nav) return;
    let pill = nav.querySelector(".tab-pill"); if (!pill) { pill = mk("span", "tab-pill"); pill.setAttribute("aria-hidden", "true"); nav.prepend(pill); nav.classList.add("has-pill");
      // follow the bar whenever it or a tab changes size (window resize, compact bar, fonts loading), so the pill never sits off its tab
      try { const ro = new ResizeObserver(() => tabPill()); ro.observe(nav); nav.querySelectorAll(".tab").forEach(t => ro.observe(t)); } catch {}
      try { document.fonts && document.fonts.ready.then(() => tabPill()); } catch {} }
    const sel = nav.querySelector('.tab[aria-selected="true"]');
    if (!sel || sel.offsetParent === null) { pill.style.opacity = "0"; return; }
    // first placement (and whenever it was hidden) jumps straight to the tab instead of sliding in from the corner
    if (pill.style.opacity !== "1" || document.body.classList.contains("splashing")) { pill.style.transition = "none"; requestAnimationFrame(() => requestAnimationFrame(() => { pill.style.transition = ""; })); }
    pill.style.width = sel.offsetWidth + "px"; pill.style.height = sel.offsetHeight + "px";
    pill.style.transform = `translate(${sel.offsetLeft}px, ${sel.offsetTop}px)`; pill.style.opacity = "1";
  }
  window.addEventListener("resize", () => { try { tabPill(); } catch {} });
  function showTab(t) {
    if (t === "discord") t = "ytm";
    if (t === "switch" && D.has && D.has.sw === false) t = "home";   // the Switch tab is only on PCs that have it
    if (TABS.includes(t)) { mainTab = t; store.set("cr.tab", t); }
    tab = t === "settings" || t === "clips" ? t : mainTab;
    document.body.classList.toggle("on-home", tab === "home");
    try { $("tbVol").hidden = tab !== "ytm"; document.body.classList.toggle("on-music", tab === "ytm"); } catch {}
    try { wdApply(); } catch {}
    try { dockRow(); setTimeout(() => { dockRow(); updateDock(); }, 320); } catch {}
    try { if (bellOpen) bellShow(false); } catch {}
    const ORDER = ["home", "ytm", "games", "stats", "switch", "web", "opera", "claude"], fromI = ORDER.indexOf(showTab.prev || ""), toI = ORDER.indexOf(tab);
    const slide = fromI >= 0 && toI >= 0 && fromI !== toI ? (toI > fromI ? "from-r" : "from-l") : "";
    showTab.prev = tab; document.body.dataset.tab = tab;
    ["home", "ytm", "games", "stats", "switch", "dcapp", "web", "opera", "claude", "discord", "settings", "clips"].forEach(k => $("tab-" + k).classList.toggle("off", k !== tab));
    try { if (tab === "opera") opShow(); else D.operaHide(); } catch {}
    try { if (tab === "dcapp") dkShow(); else D.dockHide("discord"); } catch {}
    // replay the page's entrance animation
    try { const pn = $("tab-" + tab); pn.classList.remove("enter", "from-r", "from-l"); void pn.offsetWidth; pn.classList.add("enter"); if (slide) pn.classList.add(slide); clearTimeout(showTab.enterT); showTab.enterT = setTimeout(() => pn.classList.remove("enter"), 900); } catch {}
    if (tab === "clips") loadClips(); else { try { $("clVid").pause(); } catch {} }
    D.setLayout(tab === "claude" || tab === "switch" ? "wide" : "main");   // Claude and Switch open wide like before; the rest stay Home size
    try { if (window.__rtPlaying) rtHostMute(tab !== "games"); } catch {}
    try { swActive(tab === "switch"); } catch {}
    if (tab === "claude") ensureClaude();
    if (tab === "web") wbEnsure(); else if (document.body.classList.contains("wb-full")) wbFull(false);
    if (tab === "games") loadGames();
    if (tab === "home") { try { hxRender(); } catch {} }
    if (tab === "ytm") msApply();
    TABS.forEach(k => {
      const b = $("tabbtn-" + k); if (!b) return;
      b.setAttribute("aria-selected", k === tab);
      b.tabIndex = k === tab ? 0 : -1;
    });
    try { tabPill(); setTimeout(tabPill, 330); } catch {}   // again after the bar has settled (it can change size per tab)
    document.body.classList.toggle("in-settings", tab === "settings");
    $("setBtn").setAttribute("aria-pressed", tab === "settings");
    if (tab === "stats") showGame(game);
    if (tab === "home") renderHome();
  }
  document.querySelectorAll(".tab").forEach(b => b.addEventListener("click", () => showTab(b.dataset.tab)));
  $("setBtn").onclick = () => showTab(tab === "settings" ? mainTab : "settings");
  $("setDone").onclick = () => showTab(mainTab);

  /* ---------- Window ---------- */
  let pinned = true, mini = false, startup = false, lowAlert = true, songToast = true;
  let w_compact = false;
  function applyWin(w) {
    pinned = w.pinned; mini = w.mini; startup = w.startup; lowAlert = w.lowAlert;
    w_compact = !!w.compact;
    songToast = w.songToast !== false;
    renderWin();
    try { wdPref = !!w.wideLayout; $("setWide").setAttribute("aria-checked", wdPref); wdApply(); } catch {}
  }
  function renderWin() {
    $("setPin").setAttribute("aria-checked", pinned);
    $("setStartup").setAttribute("aria-checked", startup);
    $("setMini").setAttribute("aria-checked", mini);
    $("setLowAlert").setAttribute("aria-checked", lowAlert);
    $("setSongToast").setAttribute("aria-checked", songToast);
    $("pinBtn").classList.toggle("on", pinned);
    $("pinBtn").dataset.tip = pinned ? "Always on top: on" : "Always on top: off";
    $("mPin").classList.toggle("on", pinned);
    $("mPin").dataset.tip = $("pinBtn").title;
    document.body.classList.toggle("is-mini", mini);
    M.mini.hidden = !mini;
    document.body.classList.toggle("is-compact", !!w_compact);
    $("rail").hidden = !w_compact;
  }
  const togglePin = () => D.setPinned(!pinned);
  $("setPin").onclick = $("pinBtn").onclick = $("mPin").onclick = togglePin;
  $("setStartup").onclick = () => D.setStartup(!startup);
  $("setLowAlert").onclick = () => D.setLowAlert(!lowAlert);
  D.battBrand().then(b => { $("setBattBrand").value = b; }).catch(() => {});
  $("setBattBrand").onchange = async () => { const b = await D.battBrand($("setBattBrand").value).catch(() => null); if (b) $("setBattBrand").value = b; toast(b === "off" ? "Mouse battery hidden" : "Checking your mouse…"); };
  $("setSongToast").onclick = () => D.setSongToast(!songToast);
  $("testSongToast").onclick = () => D.testSongToast();
  $("setMini").onclick = $("miniBtn").onclick = () => D.setMini(true);
  $("mExpand").onclick = () => D.setMini(false);
  $("minBtn").onclick = () => D.minimize();
  /* ---------- Close confirmation ---------- */
  const cq = $("cq");
  let cqOpen = false, cqBack = null;
  function askClose() {
    if (cqOpen) return;
    cqOpen = true; cqBack = document.activeElement;
    cq.hidden = false;
    requestAnimationFrame(() => cq.classList.add("on"));
    $("cqCancel").focus();
  }
  function closeAsk() {
    if (!cqOpen) return;
    cqOpen = false;
    cq.classList.remove("on");
    setTimeout(() => { if (!cqOpen) cq.hidden = true; }, 180);
    if (cqBack && cqBack.focus) cqBack.focus();
  }
  $("closeBtn").onclick = $("mClose").onclick = askClose;
  D.onAskClose(askClose);   // taskbar "Close window" and Alt+F4 ask too
  $("cqCancel").onclick = closeAsk;
  $("cqHide").onclick = () => { closeAsk(); D.close(); };
  $("cqQuit").onclick = () => { cqOpen = false; cq.hidden = true; D.quit(); };
  cq.addEventListener("mousedown", e => { if (e.target === cq) closeAsk(); });
  document.addEventListener("keydown", e => {
    if (!cqOpen) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); closeAsk(); }
    else if (e.key === "Tab") {
      const btns = [...cq.querySelectorAll("button")].filter(b => b.offsetParent);
      const i = btns.indexOf(document.activeElement);
      e.preventDefault();
      btns[(i + (e.shiftKey ? -1 : 1) + btns.length) % btns.length].focus();
    }
  }, true);
  D.onWindowState(applyWin);
  D.getWindow().then(applyWin);
  // Drag the frameless title bar in the renderer so it can also receive double-clicks.
  const topBar = document.querySelector(".titlebar");
  let topDrag = null;
  topBar.addEventListener("pointerdown", e => {
    if (e.button !== 0 || e.target.closest("button") || mini || w_compact || isFull) return;
    topDrag = { id: e.pointerId };
    topBar.setPointerCapture(e.pointerId);
    D.dragWin("start");
  });
  // (the window follows the mouse on its own while the button is held; see win:drag in main.js)
  window.addEventListener("blur", () => { if (topDrag) { topDrag = null; D.dragWin("end"); } });
  const endTopDrag = e => { if (topDrag && (!e || e.pointerId === topDrag.id)) { topDrag = null; D.dragWin("end"); } };
  topBar.addEventListener("pointerup", endTopDrag);
  topBar.addEventListener("pointercancel", endTopDrag);
  topBar.addEventListener("lostpointercapture", () => endTopDrag());
  // Small windows: fold three window buttons into a "…" menu so the bar has room to grab
  const tbNarrow = () => document.body.classList.toggle("tb-narrow", window.innerWidth < 720);
  window.addEventListener("resize", tbNarrow); tbNarrow();
  const tbMenu = $("tbMenu"), tbMore = $("tbMore");
  const tbMenuShow = on => {
    tbMenu.hidden = !on; tbMore.setAttribute("aria-expanded", on);
    if (on) {
      const pb = tbMenu.querySelector('[data-k="pinBtn"]'), pin = $("pinBtn").classList.contains("on");
      pb.replaceChildren("Always on top", mk("span", "st" + (pin ? " on" : ""), pin ? "On" : "Off"));
      const r = tbMore.getBoundingClientRect(); tbMenu.style.right = Math.max(8, window.innerWidth - r.right) + "px"; tbMenu.style.top = (r.bottom + 6) + "px";
    }
  };
  tbMore.onclick = e => { e.stopPropagation(); tbMenuShow(tbMenu.hidden); };
  tbMenu.addEventListener("click", e => { const b = e.target.closest("button[data-k]"); if (!b) return; tbMenuShow(false); $(b.dataset.k).click(); });
  document.addEventListener("pointerdown", e => { if (!tbMenu.hidden && !e.target.closest("#tbMenu, #tbMore")) tbMenuShow(false); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !tbMenu.hidden) tbMenuShow(false); });
  // The status chips also move the window: press and drag a few pixels (a plain click still opens them)
  let chipPress = null, chipSwallow = false;
  topBar.addEventListener("pointerdown", e => {
    const c = e.target.closest(".tb-left .batt, .tb-left h1"); if (!c || e.button !== 0 || mini || w_compact || isFull) return;
    chipPress = { id: e.pointerId, x: e.clientX, y: e.clientY };
  });
  topBar.addEventListener("pointermove", e => {
    if (!chipPress || e.pointerId !== chipPress.id || topDrag) return;
    if (Math.hypot(e.clientX - chipPress.x, e.clientY - chipPress.y) < 5) return;
    topDrag = { id: e.pointerId }; chipSwallow = true; chipPress = null;
    try { topBar.setPointerCapture(e.pointerId); } catch {}
    D.dragWin("start");
  });
  window.addEventListener("pointerup", () => { chipPress = null; setTimeout(() => { chipSwallow = false; }, 0); }, true);
  topBar.addEventListener("click", e => { if (chipSwallow) { e.preventDefault(); e.stopPropagation(); chipSwallow = false; } }, true);
  topBar.addEventListener("dblclick", e => {
    if (e.target.closest("button") || mini || w_compact) return;
    e.preventDefault();
    D.fullscreen();
  });

  // Drag the bottom-right corner to resize; each tab remembers its own size.
  const grip = $("grip");
  let drag = null, raf = 0;
  grip.addEventListener("pointerdown", e => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    drag = { x: e.screenX, y: e.screenY, w: window.outerWidth, h: window.outerHeight, nx: 0, ny: 0 };
  });
  grip.addEventListener("pointermove", e => {
    if (!drag) return;
    drag.nx = e.screenX; drag.ny = e.screenY;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (drag) D.resize({ w: drag.w + (drag.nx - drag.x), h: drag.h + (drag.ny - drag.y) });
    });
  });
  const endDrag = () => { if (drag) { drag = null; D.resizeDone(); } };
  grip.addEventListener("pointerup", endDrag);
  grip.addEventListener("pointercancel", endDrag);


  /* ---------- Mouse battery (always visible: title bar, mini player, tray icon) ---------- */
  let batt = { state: "checking" };
  const LVL = { good: "var(--good)", warn: "var(--warn)", low: "var(--bad)", none: "var(--muted)" };
  const TRAY = { good: "#1f9d63", warn: "#c7820e", low: "#c9372c", charging: "#2b6fd6" };
  const level = p => p <= 20 ? "low" : p <= 50 ? "warn" : "good";
  function ago(ts) {
    const m = Math.round((Date.now() - ts) / 60000);
    return m < 1 ? "just now" : m === 1 ? "1 minute ago" : m < 60 ? m + " minutes ago" : Math.round(m / 60) + " h ago";
  }
  const STATES = {
    checking: ["Checking your mouse…", ""],
    asleep: ["Not responding", "Your mouse is asleep, disconnected, or not responding. Move it, then refresh."],
    none: ["No mouse found", "Plug in your mouse's receiver or cable (or pick your brand in Settings → Mouse battery), then refresh."],
    unsupported: ["Not supported", "Your mouse is connected, but it doesn't share its battery level this way."],
    off: ["Off", "Turned off in Settings → Mouse battery."],
    error: ["Couldn't read", "Couldn't read the mouse. Wake it and refresh."]
  };

  let battNoted = 100;
  function renderBattery(b) {
    if (b) batt = b;
    if (batt.state === "ok" && !batt.charging && window.__sothisNote) { const p = batt.percent; if ((p <= 20 && battNoted > 20) || (p <= 10 && battNoted > 10)) window.__sothisNote("battery", "Mouse battery " + p + "%", "Time to charge it"); battNoted = p; } else if (batt.charging) battNoted = 100;
    const ok = batt.state === "ok";
    const p = ok ? batt.percent : 0;
    const lvl = ok ? (batt.charging ? "good" : level(p)) : "none";
    const color = LVL[lvl];

    let tip;
    if (ok) {
      const how = batt.stale ? "asleep, last reading" : batt.charging ? (p >= 100 ? "fully charged" : "charging") : "on battery";
      tip = `Mouse battery ${p}% (${how})`;
      tip += "\n" + (batt.product || "Mouse") + (batt.connection ? " · " + batt.connection : "");
    } else {
      const [label, note] = STATES[batt.state] || STATES.error;
      tip = "Mouse battery: " + label + (note || batt.message ? "\n" + (batt.state === "error" && batt.message ? batt.message : note) : "");
    }
    tip += "\n" + (batt.checking ? "Checking…" : (batt.at ? "Updated " + ago(batt.at) + ". " : "") + "Click to refresh.");
    [["battBadge", "battBadgeLvl", "battBadgeText"], ["mBatt", "mBattLvl", "mBattText"]].forEach(([w, l, t]) => {
      $(w).classList.toggle("unknown", !ok);
      $(w).dataset.tip = tip;
      $(l).style.width = ok ? Math.max(p, 4) + "%" : "0";
      $(l).style.setProperty("--lvl", color);
      $(t).textContent = ok ? p + "%" : "--%";
    });
    $("battBadgeBolt").hidden = !(ok && batt.charging);
    // no battery chip when the mouse reading is turned off
    $("battBadge").hidden = batt.state === "off"; $("mBatt").hidden = batt.state === "off";

    drawTray();
  }

  // The tray icon shows the percentage so it's visible even when the window is hidden.
  let trayKey = "";
  function trayImage(size) {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d");
    const p = batt.percent;
    g.fillStyle = batt.charging ? TRAY.charging : TRAY[level(p)];
    g.beginPath(); g.roundRect(0, 0, size, size, size * 0.24); g.fill();
    const text = String(p);
    g.fillStyle = "#ffffff";
    g.font = `700 ${Math.round(size * (text.length > 2 ? 0.44 : 0.62))}px "Segoe UI", Arial, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, size / 2, size / 2 + size * 0.05);
    return c.toDataURL("image/png");
  }
  function drawTray() {
    const ok = batt.state === "ok";
    const key = ok ? batt.percent + "|" + !!batt.charging : "default";
    if (key === trayKey) return;
    trayKey = key;
    D.setTrayIcon(ok ? { x1: trayImage(16), x2: trayImage(32) } : null);
  }

  D.onBattery(renderBattery);
  D.getBattery().then(renderBattery);
  setInterval(() => renderBattery(), 30000);
  let refreshing = false;
  async function refreshNow() {
    if (refreshing) return;
    refreshing = true;
    $("battBadge").classList.add("busy"); $("mBatt").classList.add("busy");
    renderBattery(Object.assign({}, batt, { checking: true }));
    try { renderBattery(await D.refreshBattery()); }
    finally { refreshing = false; $("battBadge").classList.remove("busy"); $("mBatt").classList.remove("busy"); }
  }
  $("battBadge").onclick = refreshNow;
  $("mBatt").onclick = refreshNow;


  /* ---------- Tray menu + taskbar preview controls ---------- */
  /* YouTube Music state, read from inside its tab */
  let ytState = null;
  const YT_READ = `(() => {
    const v = document.querySelector("video");
    const bar = document.querySelector("ytmusic-player-bar");
    const mp = document.getElementById("movie_player");
    const t = bar && bar.querySelector(".title");
    const by = bar && bar.querySelector(".byline");
    const title = t ? t.textContent.trim() : "";
    let vol = v ? v.volume : 0.5;
    try { if (mp && mp.getVolume) vol = mp.getVolume() / 100; } catch (e) {}
    let art = "";
    try { const a = navigator.mediaSession.metadata && navigator.mediaSession.metadata.artwork; if (a && a.length) art = a[a.length - 1].src; } catch (e) {}
    if (!art) { const im = bar && bar.querySelector("img"); if (im) art = im.src; }
    return { has: !!(v && title), playing: !!(v && !v.paused && !v.ended), title, artist: by ? by.textContent.split("•")[0].trim() : "", volume: vol, art, pos: v ? v.currentTime : 0, dur: v && isFinite(v.duration) ? v.duration : 0 };
  })()`;
  // Spotify / Apple Music: what's playing, read from the page (Media Session, the player, MusicKit on Apple)
  const MS_READ = `(() => {
    const host = location.hostname, ms = navigator.mediaSession, md = ms && ms.metadata;
    const media = [...document.querySelectorAll("video,audio")].find(m => m.duration > 0) || null;
    let pos = 0, dur = 0, playing = false, vol = 0.5;
    if (/apple/.test(host)) { try { const mk = window.MusicKit && MusicKit.getInstance(); if (mk) { pos = mk.currentPlaybackTime || 0; dur = mk.currentPlaybackDuration || 0; playing = !!mk.isPlaying; if (typeof mk.volume === "number") vol = mk.volume; } } catch (e) {} }
    if (/spotify/.test(host)) {
      const b = document.querySelector('[data-testid="control-button-playpause"]'); if (b) playing = /pause/i.test(b.getAttribute("aria-label") || "");
      const t = id => { const e = document.querySelector('[data-testid="' + id + '"]'); return e ? e.textContent.trim().split(":").reduce((a, x) => a * 60 + (+x || 0), 0) : 0; };
      pos = t("playback-position"); dur = t("playback-duration");
      const vr = document.querySelector('[data-testid="volume-bar"] input[type=range]'); if (vr) vol = (+vr.value) / (+vr.max || 1);
    }
    if (media) { if (!dur && isFinite(media.duration)) { dur = media.duration; pos = media.currentTime; } if (!playing) playing = !media.paused; }
    if (ms && ms.playbackState === "playing") playing = true;
    const aw = md && md.artwork ? [...md.artwork] : [], art = aw.length ? aw[aw.length - 1].src : "";
    return { has: !!(md && md.title), playing, title: md ? md.title || "" : "", artist: md ? md.artist || "" : "", volume: vol, art, pos, dur };
  })()`;
  const msCmdJs = (cmd, value) => `(() => {
    const cmd = ${JSON.stringify(cmd)}, value = ${JSON.stringify(value ?? null)}, host = location.hostname, q = s => document.querySelector(s);
    const setRange = (el, v) => { if (!el) return; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(el, String(v)); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); };
    if (/apple/.test(host)) {
      const mk = window.MusicKit && MusicKit.getInstance(); if (!mk) return;
      if (cmd === "playpause") mk.isPlaying ? mk.pause() : mk.play();
      else if (cmd === "next") mk.skipToNextItem();
      else if (cmd === "prev") mk.skipToPreviousItem();
      else if (cmd === "seek" && mk.currentPlaybackDuration) mk.seekToTime(Math.max(0, Math.min(1, value)) * mk.currentPlaybackDuration);
      else if (cmd === "vol") mk.volume = Math.max(0, Math.min(1, value));
      else if (cmd === "volstep") mk.volume = Math.max(0, Math.min(1, (mk.volume || 0) + value));
      return;
    }
    const tid = id => q('[data-testid="' + id + '"]');
    if (cmd === "playpause") { const b = tid("control-button-playpause"); if (b) b.click(); }
    else if (cmd === "next") { const b = tid("control-button-skip-forward"); if (b) b.click(); }
    else if (cmd === "prev") { const b = tid("control-button-skip-back"); if (b) b.click(); }
    else if (cmd === "seek") { const r = q('[data-testid="playback-progressbar"] input[type=range]'); if (r) setRange(r, Math.round(Math.max(0, Math.min(1, value)) * (+r.max || 0))); }
    else if (cmd === "vol" || cmd === "volstep") { const r = q('[data-testid="volume-bar"] input[type=range]'); if (r) { const mx = +r.max || 1, cur = (+r.value) / mx; setRange(r, Math.round(Math.max(0, Math.min(1, cmd === "vol" ? value : cur + value)) * mx * 1000) / 1000); } }
  })()`;
  const musWv = () => musicSvc === "ytm" ? yt : msv;
  async function pollYT() {
    const wv = musWv();
    if (!wv) { ytState = null; renderMiniYT(); return; }
    try { ytState = await wv.executeJavaScript(musicSvc === "ytm" ? YT_READ : MS_READ); } catch { ytState = null; }
    try { lyStateAt = Date.now(); } catch {}
    renderMiniYT();
  }
  function renderMiniYT() {
    const y = ytState && ytState.has ? ytState : null;
    M.mTitle.textContent = y ? y.title || "Nothing playing" : "Nothing playing";
    M.mArtist.textContent = y ? y.artist || msName() : "Open " + msName() + " to start";
    if (y && y.art) { if (M.mThumb.getAttribute("src") !== y.art) M.mThumb.src = y.art; } else M.mThumb.removeAttribute("src");
    M.mFill.style.width = (y && y.dur ? Math.min(100, y.pos / y.dur * 100) : 0) + "%";
    M.mPlayIcon.innerHTML = y && y.playing ? PAUSE : PLAY;
    M.mPlay.setAttribute("aria-label", y && y.playing ? "Pause" : "Play");
    document.querySelectorAll(".mctl button").forEach(b => b.disabled = !yt);
  }
  setInterval(pollYT, 1000);
  function ytCmd(cmd, value) {
    if (musicSvc !== "ytm") { if (msv) msv.executeJavaScript(msCmdJs(cmd, value), true).then(() => setTimeout(() => pollYT().then(report), 250)).catch(() => {}); return; }
    if (!yt) return;
    const js = `(() => {
      const mp = document.getElementById("movie_player");
      const q = s => document.querySelector(s);
      const cmd = ${JSON.stringify(cmd)}, value = ${JSON.stringify(value ?? null)};
      if (cmd === "playpause") {
        // press the page's own button, then make sure it took: YouTube Music sometimes ignores a press while it's busy
        const v = q("video"), was = v ? v.paused : null;
        const b = q("ytmusic-player-bar #play-pause-button");
        if (b) b.click(); else if (v) { if (was) v.play().catch(() => {}); else v.pause(); }
        if (v) setTimeout(() => {
          if (v.paused !== was) return;
          try { if (was) { mp && mp.playVideo ? mp.playVideo() : v.play().catch(() => {}); } else { mp && mp.pauseVideo ? mp.pauseVideo() : v.pause(); } } catch (e) {}
          setTimeout(() => { if (v.paused === was) { if (was) v.play().catch(() => {}); else v.pause(); } }, 250);
        }, 350);
      }
      else if (cmd === "next") { const b = q("ytmusic-player-bar .next-button"); if (b) b.click(); else if (mp && mp.nextVideo) mp.nextVideo(); }
      else if (cmd === "prev") { const b = q("ytmusic-player-bar .previous-button"); if (b) b.click(); else if (mp && mp.previousVideo) mp.previousVideo(); }
      else if (cmd === "seek") { const v = q("video"); if (v && isFinite(v.duration)) v.currentTime = Math.max(0, Math.min(1, value)) * v.duration; }
      else if (cmd === "vol" || cmd === "volstep") {
        let cur = 50; try { cur = mp.getVolume(); } catch (e) { const v = q("video"); if (v) cur = v.volume * 100; }
        const n = Math.max(0, Math.min(100, Math.round(cmd === "vol" ? value * 100 : cur + value * 100)));
        try { mp.setVolume(n); if (n > 0 && mp.isMuted && mp.isMuted()) mp.unMute(); } catch (e) { const v = q("video"); if (v) v.volume = n / 100; }
      }
    })()`;
    // run it as if you clicked, so the page is allowed to start playback
    yt.executeJavaScript(js, true).then(() => { setTimeout(() => pollYT().then(report), 250); if (cmd === "playpause") setTimeout(() => pollYT().then(report), 900); }).catch(() => {});
  }
  let lastReport = "";
  function report() {
    const y = ytState && ytState.has ? ytState : null;
    const p = {
      connected: !!y,
      playing: !!(y && y.playing),
      volume: y ? y.volume : 0.5,
      title: y ? y.title : "",
      artist: y ? y.artist : "",
      art: y ? y.art || "" : "",
      svc: musicSvc
    };
    const k = JSON.stringify(p);
    if (k !== lastReport) { lastReport = k; D.reportPlayer(p); }
  }
  setInterval(report, 700);
  D.onRemote(({ cmd, value }) => ytCmd(cmd, value));

  /* ---------- Music volume sliders (mini player + bottom bar on the music tab) ---------- */
  function wireMusicVol(el) {
    let drag = false, t = null;
    const paint = () => el.style.setProperty("--p", el.value + "%");
    const sync = () => {
      if (drag || !ytState) return;
      const v = Math.round(ytState.volume * 100);
      if (+el.value !== v) { el.value = v; paint(); }
    };
    setInterval(sync, 500);
    el.addEventListener("pointerdown", () => { drag = true; });
    window.addEventListener("pointerup", () => { if (drag) { drag = false; setTimeout(sync, 1200); } });
    el.addEventListener("input", () => {
      paint(); clearTimeout(t);
      t = setTimeout(() => { const v = +el.value / 100; if (ytState) ytState.volume = v; ytCmd("vol", v); }, 60);
    });
    el.addEventListener("wheel", e => { e.preventDefault(); el.value = Math.max(0, Math.min(100, +el.value + (e.deltaY < 0 ? 5 : -5))); el.dispatchEvent(new Event("input")); }, { passive: false });
    paint();
  }
  wireMusicVol($("mVol")); wireMusicVol($("tbVolIn"));

