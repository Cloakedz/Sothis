  /* ---------- Keep content clear of the corner buttons ---------- */
  // The Claude / sound / Discord buttons (left) and the launcher column (right) float over the bottom
  // corners. Content on every tab ends just above the tallest of them, so nothing sits underneath.
  let dockNow = 0;
  function updateDock() {
    const panels = document.querySelector(".panels"); if (!panels) return;
    const pb = panels.getBoundingClientRect().bottom;
    let top = Infinity;
    for (const el of [$("launchCol"), $("dcBtn"), $("sndBtn"), $("tabbtn-claude")]) {
      if (!el || el.hidden || getComputedStyle(el).display === "none" || getComputedStyle(el).visibility === "hidden") continue;
      const r = el.getBoundingClientRect(); if (r.height > 0) top = Math.min(top, r.top);
    }
    const need = top === Infinity ? (tab === "ytm" ? 94 : 82) : Math.max(tab === "ytm" ? 94 : 82, Math.round(pb - top + 8));
    if (need !== dockNow) { dockNow = need; document.documentElement.style.setProperty("--dock", need + "px"); }
  }
  // On Switch and Music, line Discord + sound up beside the Claude button and slide the tab bar over to make room
  function dockRow() {
    // every wide (landscape) page, plus Music
    // every page: all the corner buttons sit in one row with the tab bar, so nothing stacks up over the content
    const row = !document.body.classList.contains("is-mini");
    document.body.classList.toggle("dock-row", row);
    const nav = document.querySelector(".tabs"); if (!nav) return;
    nav.style.left = ""; nav.classList.remove("compact", "tiny");
    if (document.body.classList.contains("wide")) return;   // the Wide layout keeps the tabs in a rail on the left
    if (!row) {
      // portrait pages: keep the bar clear of the launcher column (Opera etc.) on the right
      const lc = $("launchCol"); if (!lc || !lc.children.length) return;
      const hit = () => { const a = nav.getBoundingClientRect(); return [...lc.children].some(c => { if (c.offsetParent === null) return false; const b = c.getBoundingClientRect(); return b.width && a.right + 6 > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom; }); };
      if (!hit()) return;
      nav.classList.add("compact");
      if (!hit()) return;
      nav.classList.add("tiny");
      if (!hit()) return;
      const b = Math.min(...[...lc.children].filter(c => c.offsetParent !== null).map(c => c.getBoundingClientRect().left));
      nav.style.left = Math.round(Math.max(nav.offsetWidth / 2 + 8, b - 10 - nav.offsetWidth / 2)) + "px";
      return;
    }
    const W = window.innerWidth;
    let leftEnd = 0;
    for (const el of [$("tabbtn-claude"), $("sndBtn"), $("dcBtn")]) {
      if (!el || el.hidden) continue;
      const cs = getComputedStyle(el); if (cs.display === "none") continue;
      leftEnd = Math.max(leftEnd, (parseFloat(cs.left) || 0) + el.offsetWidth);
    }
    const lc = $("launchCol"), rightStart = lc && lc.children.length ? W - (W - lc.getBoundingClientRect().left) : W - 12;
    const lo = leftEnd + 12, hi = Math.min(rightStart, W) - 14;
    const fits = w => (W - w) / 2 >= lo && (W + w) / 2 <= hi;
    let w = nav.offsetWidth;
    if (!fits(w)) {
      if (w > hi - lo) { nav.classList.add("compact"); w = nav.offsetWidth; }
      if (w > hi - lo) { nav.classList.add("tiny"); w = nav.offsetWidth; }
      const c = Math.max(lo + w / 2, Math.min(hi - w / 2, W / 2));
      nav.style.left = Math.round(c) + "px";
    }
  }
  window.addEventListener("resize", () => { dockRow(); updateDock(); });
  new MutationObserver(updateDock).observe($("launchCol"), { childList: true, subtree: true, attributes: true });
  new MutationObserver(updateDock).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  ["dcBtn", "sndBtn"].forEach(id => new MutationObserver(updateDock).observe($(id), { attributes: true, attributeFilter: ["hidden"] }));
  setInterval(() => { dockRow(); updateDock(); }, 2000);
  setTimeout(updateDock, 300);

  /* ---------- Keyboard ---------- */
  document.addEventListener("keydown", e => {
    if (e.ctrlKey && !e.altKey && e.key === ",") { e.preventDefault(); showTab(tab === "settings" ? mainTab : "settings"); return; }
    if (e.ctrlKey && !e.altKey && ["1", "2", "3", "4", "5", "6"].includes(e.key)) { e.preventDefault(); showTab(["home", "ytm", "games", "stats", "switch", "claude"][+e.key - 1]); return; }
    if (e.key === "Escape" && tab === "settings") { showTab(mainTab); return; }
    if (e.target.matches("input, textarea") || !mini) return;
    if (e.code === "Space") { e.preventDefault(); ytCmd("playpause"); }
    else if (e.key === "ArrowRight") ytCmd("next");
    else if (e.key === "ArrowLeft") ytCmd("prev");
    else if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); ytCmd("volstep", e.key === "ArrowUp" ? 0.05 : -0.05); }
  });

  /* ---------- Start ---------- */
  /* ---------- Game sessions: a recap card on Home after you close a game ---------- */
  const SESS_LOGO = { "Overwatch 2": "ow", "Rainbow Six Siege": "r6", "Counter-Strike 2": "cs", "Nintendo Switch (Eden)": "switch" };
  let sessNow = null, sessRec = null;
  const dur = ms => { const m = Math.max(1, Math.round(ms / 60000)), h = Math.floor(m / 60); return h ? `${h}h ${m % 60}m` : `${m}m`; };
  function sessLiveRender() {
    $("sessLive").hidden = !sessNow;
    if (sessNow) $("sessLiveT").textContent = `Playing ${sessNow.game} · ${dur(Date.now() - sessNow.start)}`;
  }
  setInterval(sessLiveRender, 30000);
  function sessRender() {
    const r = sessRec;
    $("hmSess").hidden = !r;
    if (!r) return;
    const lg = SESS_LOGO[r.game];
    $("sessLogo").hidden = !lg; if (lg) $("sessLogo").dataset.logo = lg;
    $("sessTitle").textContent = r.game;
    const t0 = new Date(r.start), t1 = new Date(r.end), hm = d => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    $("sessSub").textContent = `Session recap · ${hm(t0)}–${hm(t1)}` + (Date.now() - r.end > 20 * 3600000 ? " · " + t0.toLocaleDateString([], { month: "short", day: "numeric" }) : "");
    const st = $("sessStats"); st.replaceChildren();
    const add = (k, v, cls, click) => { const b = mk(click ? "button" : "div", "sess-st"); if (click) { b.type = "button"; b.onclick = click; } b.append(mk("i", "", k), mk("b", cls || "", v)); st.append(b); };
    add("Played", dur(r.end - r.start));
    const x = r.extra || {};
    if (x.w != null) add("Matches", `${x.w}W – ${x.l}L`);
    if (typeof x.rp === "number") add("RP", (x.rp > 0 ? "+" : "") + x.rp.toLocaleString("en-US") + " RP", x.rp > 0 ? "up" : x.rp < 0 ? "down" : "");
    if (x.rank) add("Rank", x.rank);
    else if (r.rank0 && r.rank0.name) add("Rank", r.rank0.name);
    add("Clips", r.clips ? String(r.clips) : "None", "", r.clips ? () => showTab("clips") : null);
    const maps = $("sessMaps"); maps.replaceChildren();
    const list = (x.maps && x.maps.length ? x.maps : (r.maps || []).map(n => ({ name: n, img: (r.mapImgs || {})[n] || "" }))).slice(0, 10);
    maps.hidden = !list.length;
    list.forEach(m => {
      const c = mk("div", "sess-map" + (m.res === "win" ? " w" : m.res === "loss" ? " l" : ""));
      if (m.img) { const im = mk("img"); im.alt = ""; im.loading = "lazy"; im.referrerPolicy = "no-referrer"; im.onerror = () => im.remove(); im.src = m.img; c.append(im); }
      c.append(mk("span", "", m.name + (m.res === "win" ? " · W" : m.res === "loss" ? " · L" : "")));
      c.title = m.name; maps.append(c);
    });
  }
  // Work out wins, losses and rank change from the stats sites once the game has closed
  async function sessEnrich(r) {
    try {
      if (r.game === "Rainbow Six Siege" && R6.id) {
        await loadR6(true);
        const c = r6Cache; if (!c || !Array.isArray(c.matches)) return;
        const cfg = (c.config && c.config.maps) || {};
        const inSess = c.matches.filter(m => { const e = Date.parse(m.ended_at || ""); return e && e >= r.start - 5 * 60000 && e <= r.end + 10 * 60000; });
        if (!inSess.length) return;
        let w = 0, l = 0, rp = 0, hasRp = false;
        const maps = inSess.slice().reverse().map(m => {
          const o = String((m.player_summary || {}).outcome || ""), rs = m.ranked_session;
          if (o === "win") w++; else if (o === "loss") l++;
          if (rs && typeof rs.rank_points_delta === "number" && !/unranked/.test(rs.rank || "") && Math.abs(rs.rank_points_delta) < 500) { rp += rs.rank_points_delta; hasRp = true; }
          return { name: cfg[m.map] || slugName(m.map), img: /^[a-z0-9-]+$/.test(m.map || "") ? `https://static.stats.cc/siege/maps/${m.map}_thumbnail.webp` : "", res: o };
        });
        const extra = { w, l, maps };
        if (hasRp) extra.rp = rp;
        r.extra = extra; await D.sessionSave(extra);
      } else if (r.game === "Overwatch 2" || r.game === "Counter-Strike 2") {
        await (r.game === "Overwatch 2" ? loadOW(true) : loadCS(true));
        await new Promise(res => setTimeout(res, 1500));
        const before = r.rank0 && r.rank0.name;
        const after = r.game === "Overwatch 2" ? (window.__owRank || "") : (window.__csRank || "");
        if (before && after && before !== after) { r.extra = Object.assign({}, r.extra, { rank: `${before} → ${after}` }); await D.sessionSave(r.extra); }
      }
    } catch {}
    if (sessRec === r) sessRender();
  }
  D.onSession((k, d) => {
    if (k === "start") { sessNow = d; sessLiveRender(); }
    else if (k === "stop") { sessNow = null; sessLiveRender(); }
    else if (k === "end") { sessRec = d; sessRender(); sessEnrich(d); }
  });
  $("sessX").onclick = () => { sessRec = null; sessRender(); D.sessionDismiss(); };
  D.sessionLast().then(r => { if (r) { sessRec = r; sessRender(); } }).catch(() => {});
  D.sessionNow().then(n => { sessNow = n; sessLiveRender(); }).catch(() => {});

  /* ---------- Gaming settings: match found alert, lower the music ---------- */
  let qpC = true, duckC = { game: false, talk: true, level: 0.35 };
  const duckPaint = () => {
    $("setDuckTalk").setAttribute("aria-checked", !!duckC.talk);
    $("setDuckGame").setAttribute("aria-checked", !!duckC.game);
    $("duckLvl").value = Math.round(duckC.level * 100); $("duckLvlOut").textContent = Math.round(duckC.level * 100) + "%";
  };
  D.qpGet().then(v => { qpC = v !== false; $("setQp").setAttribute("aria-checked", qpC); }).catch(() => {});
  $("setQp").onclick = () => D.qpSet(!qpC).then(v => { qpC = v; $("setQp").setAttribute("aria-checked", qpC); });
  $("qpTest").onclick = () => D.qpTest();
  D.duckGet().then(c => { duckC = c; duckPaint(); }).catch(() => {});
  $("setDuckTalk").onclick = () => D.duckSet({ talk: !duckC.talk }).then(c => { duckC = c; duckPaint(); });
  $("setDuckGame").onclick = () => D.duckSet({ game: !duckC.game }).then(c => { duckC = c; duckPaint(); });
  $("duckLvl").addEventListener("input", () => { $("duckLvlOut").textContent = $("duckLvl").value + "%"; });
  $("duckLvl").addEventListener("change", () => D.duckSet({ level: +$("duckLvl").value / 100 }).then(c => { duckC = c; duckPaint(); }));

