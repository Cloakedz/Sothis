  /* ---------- Games tab: Retro (your own game files) ---------- */
  let gmMode = ["retro", "rel", "mods"].includes(store.get("gm.mode")) ? store.get("gm.mode") : "pc", rtData = null, rtSys = "All", rtDirsOpen = false, rtBusy = false;
  function gmModeShow() {
    document.querySelectorAll("#gmMode button").forEach(b => b.setAttribute("aria-checked", b.dataset.m === gmMode));
    const rel = gmMode === "rel", mods = gmMode === "mods";
    $("gmRel").hidden = !rel; $("gmMods").hidden = !mods;
    if (mods) { $("gmRetro").hidden = true; $("gmGrid").hidden = true; $("gmMsg").hidden = true; $("gmNews").hidden = true; $("gmShowHidden").hidden = true; $("gmQ").placeholder = "Find a modded setup"; mo2Load(); return; }
    if (rel) { $("gmRetro").hidden = true; $("gmGrid").hidden = true; $("gmMsg").hidden = true; $("gmNews").hidden = true; $("gmShowHidden").hidden = true; $("gmQ").placeholder = "Find a release"; relLoad(); return; }
    const retro = gmMode === "retro";
    $("gmRetro").hidden = !retro;
    $("gmGrid").hidden = retro; $("gmMsg").hidden = retro; if (retro) $("gmNews").hidden = true; else { gmNewsKey = ""; gmNewsFill(); }
    if (retro) { $("gmShowHidden").hidden = true; $("gmQ").placeholder = "Find a retro game"; loadRetro(); }
    else { $("gmQ").placeholder = "Find a game"; renderGames(); }
  }
  document.querySelectorAll("#gmMode button").forEach(b => b.onclick = () => { gmMode = b.dataset.m; store.set("gm.mode", gmMode); gmModeShow(); });
  async function loadRetro(force) {
    if (rtBusy || (rtData && !force)) return renderRetro();
    rtBusy = true; $("gmRef").classList.add("spin");
    if (!rtData) $("rtMsg").textContent = "Looking for your game files…";
    try { rtData = await D.emuList(); } catch { rtData = { dirs: [], items: [] }; }
    rtBusy = false; $("gmRef").classList.remove("spin");
    renderRetro();
    loadLib(!!force);
  }
  const thumbName = n => n.replace(/[&*/:`<>?\\|"]/g, "_");
  function renderRetro() {
    const d = rtData || { dirs: [], items: [] };
    const items = d.items || [];
    const systems = [...new Set(items.map(x => x.sys))];
    if (rtSys !== "All" && !systems.includes(rtSys)) rtSys = "All";
    // filter chips + folders button
    const bar = $("rtBar"); bar.replaceChildren();
    if (items.length) ["All", ...systems].forEach(sy => {
      const c = mk("button", "chip", sy === "All" ? `All (${items.length})` : sy); c.type = "button"; c.setAttribute("aria-pressed", sy === rtSys);
      c.onclick = () => { rtSys = sy; renderRetro(); }; bar.append(c);
    });
    bar.append(mk("span", "rt-sp"));
    if (items.length) rtShelfBar(bar);
    const fb = mk("button", "linkbtn", rtDirsOpen ? "Done" : "Folders"); fb.type = "button"; fb.onclick = () => { rtDirsOpen = !rtDirsOpen; renderRetro(); }; bar.append(fb);
    // folders
    const dirs = $("rtDirs"); dirs.replaceChildren(); dirs.hidden = !rtDirsOpen;
    (d.dirs || []).forEach(dir => {
      const r = mk("div", "rt-dir"); r.append(mk("span", "", dir));
      if (d.picked) { const x = mk("button", "linkbtn", "Remove"); x.type = "button"; x.onclick = async () => { await D.emuRemoveDir(dir); loadRetro(true); }; r.append(x); }
      dirs.append(r);
    });
    if (!(d.dirs || []).length) dirs.append(mk("div", "rt-dir", "No folders yet."));
    const ar = mk("div", "rt-dir"); const ab = mk("button", "linkbtn", "+ Add a folder"); ab.type = "button"; ab.onclick = rtAddDir; ar.append(ab);
    dirs.append(ar);
    dirs.append(rtSyncRow());
    if (items.length) dirs.append(rtDupRow());
    // grid: one card per game (original + patched copies together), once the library has worked out what each file is
    const q = $("gmQ").value.trim().toLowerCase();
    $("rtEmpty").hidden = !!items.length || rtBusy;
    const grid = $("rtGrid"); grid.replaceChildren();
    const groups = rtGroups().filter(g => (rtSys === "All" || g.sys === rtSys) && (!q || g.title.toLowerCase().includes(q) || g.versions.some(v => v.file.toLowerCase().includes(q))) && rtShelfOk(g));
    rtSortList(groups);
    $("rtMsg").textContent = rtBusy && !rtData ? "Looking for your game files…" : rtLibBusy && !rtLib ? "Working out which games you have…" + (rtLibProg ? " " + rtLibProg : "") : items.length && !groups.length ? (rtShelf !== "all" ? "Nothing on this shelf yet." : "No game matches that.") : "";
    groups.slice(0, 600).forEach(g => {
      const c = mk("button", "gm-card rt-card" + (g.st.done ? " done" : "")); c.type = "button"; c.setAttribute("aria-label", g.title);
      const art = mk("div", "gm-art rt");
      const init = mk("span", "gm-init", g.title.slice(0, 28));
      const im = mk("img"); im.alt = ""; im.loading = "lazy"; im.referrerPolicy = "no-referrer";
      im.onerror = () => { im.remove(); if (!init.isConnected) art.prepend(init); };
      art.append(init, mk("span", "rt-sys", g.sys));
      if (g.st.done) art.append(mk("span", "rt-done", "✓"));
      if (g.versions.length > 1) art.append(mk("span", "rt-vers", g.versions.length + " versions"));
      if (g.dup) art.append(mk("span", "rt-dupb", "Duplicate"));
      rtArt(g.main.token).then(u => { if (u) { im.onload = () => init.remove(); im.src = u; art.prepend(im); } });
      const sub = [g.sys, g.year, g.st.time ? rtHrs(g.st.time) : ""].filter(Boolean).join(" · ");
      c.append(art, mk("div", "gm-name", g.title), mk("div", "gm-store", sub));
      c.title = g.versions.map(v => v.file).join("\n");
      c.onclick = () => rtDetail(g.key);
      c.ondblclick = e => { e.preventDefault(); rtPlayGame(rtAsGame(g.main)); };
      grid.append(c);
    });
  }
  /* ---------- Retro library: groups, sorting, shelves, details ---------- */
  let rtLib = null, rtLibBusy = false, rtLibProg = "", rtSort = store.get("rt.sort") || "name", rtShelf = store.get("rt.shelf") || "all";
  const rtArtCache = new Map();
  const rtArt = token => rtArtCache.get(token) || (rtArtCache.set(token, D.emuArt(token).catch(() => "")), rtArtCache.get(token));
  const rtHrs = ms => { const m = Math.round(ms / 60000); return m < 60 ? m + " min" : (m / 60).toFixed(m < 600 ? 1 : 0).replace(/\.0$/, "") + " h"; };
  const rtSize = b => b >= 1073741824 ? (b / 1073741824).toFixed(1) + " GB" : Math.max(1, Math.round(b / 1048576)) + " MB";
  const rtAsGame = v => ({ token: v.token, name: v.title, sys: v.sys, file: v.file, azahar: false, size: v.size, dir: v.dir });
  async function loadLib(force) {
    if (rtLibBusy) return;
    rtLibBusy = true; rtLibProg = ""; if (gmMode === "retro") renderRetro();
    try { rtLib = await D.libGet(!!force); } catch {}
    rtLibBusy = false; rtLibProg = "";
    if (gmMode === "retro") renderRetro();
    if (rtDetKey && !$("rtDet").hidden) rtDetail(rtDetKey);
  }
  D.onLibProgress(p => { if (!p) return; rtLibProg = p.finished ? "" : `${p.done} of ${p.total}`; if (!rtLib && gmMode === "retro") $("rtMsg").textContent = "Working out which games you have… " + rtLibProg; });
  function rtGroups() {
    // before the library is ready, every file is its own card
    const stats = (rtLib && rtLib.stats) || {};
    const items = rtLib && rtLib.items && rtLib.items.length ? rtLib.items : ((rtData && rtData.items) || []).filter(x => !x.azahar).map(x => ({ token: x.token, file: x.file, path: (x.dir || "") + "\\" + x.file, dir: x.dir, size: x.size, sys: x.sys, key: x.sys + "|" + x.name.toLowerCase(), title: x.name.replace(/\s*[\(\[].*$/, "") || x.name, patched: /patched|hack/i.test(x.name), region: "", year: "", genre: "", dev: "", crc: "", how: "" }));
    const m = new Map();
    for (const v of items) {
      let g = m.get(v.key);
      if (!g) m.set(v.key, g = { key: v.key, title: v.title, sys: v.sys, year: "", genre: "", dev: "", versions: [], dup: false });
      g.versions.push(v);
      if (!g.year && v.year) g.year = v.year; if (!g.genre && v.genre) g.genre = v.genre; if (!g.dev && v.dev) g.dev = v.dev;
      if (v.dup) g.dup = true;
    }
    for (const g of m.values()) {
      g.st = Object.assign({ time: 0, last: 0, plays: 0, done: false }, stats[g.key] || {});
      g.versions.sort((a, b) => (a.patched - b.patched) || ((b.how === "crc") - (a.how === "crc")) || a.file.localeCompare(b.file));
      g.main = g.versions.find(v => v.token === g.st.prefer) || g.versions[0];
    }
    return [...m.values()];
  }
  function rtShelfOk(g) {
    if (rtShelf === "all") return true;
    if (rtShelf === "unfinished") return !g.st.done;
    if (rtShelf === "finished") return g.st.done;
    if (rtShelf === "recent") return !!g.st.last;
    if (rtShelf.startsWith("col:")) { const c = ((rtLib && rtLib.cols) || []).find(x => x.name === rtShelf.slice(4)); return !!(c && c.keys.includes(g.key)); }
    return true;
  }
  function rtSortList(l) {
    const by = { name: (a, b) => a.title.localeCompare(b.title), recent: (a, b) => (b.st.last - a.st.last) || a.title.localeCompare(b.title), most: (a, b) => (b.st.time - a.st.time) || a.title.localeCompare(b.title),
      year: (a, b) => ((a.year || "9999") + a.title).localeCompare((b.year || "9999") + b.title), system: (a, b) => (a.sys + a.title).localeCompare(b.sys + b.title) }[rtShelf === "recent" ? "recent" : rtSort] || ((a, b) => a.title.localeCompare(b.title));
    l.sort(by);
  }
  function rtShelfBar(bar) {
    const shelf = mk("select", "rt-sel"); shelf.setAttribute("aria-label", "Shelf");
    const cols = (rtLib && rtLib.cols) || [];
    [["all", "All games"], ["recent", "Recently played"], ["unfinished", "Unfinished"], ["finished", "Finished"], ...cols.map(c => ["col:" + c.name, c.name])].forEach(([v, t]) => { const o = mk("option", "", t); o.value = v; shelf.append(o); });
    if (![...shelf.options].some(o => o.value === rtShelf)) rtShelf = "all";
    shelf.value = rtShelf; shelf.onchange = () => { rtShelf = shelf.value; store.set("rt.shelf", rtShelf); renderRetro(); };
    const sort = mk("select", "rt-sel"); sort.setAttribute("aria-label", "Sort");
    [["name", "A–Z"], ["recent", "Last played"], ["most", "Most played"], ["year", "Year"], ["system", "System"]].forEach(([v, t]) => { const o = mk("option", "", t); o.value = v; sort.append(o); });
    sort.value = rtSort; sort.onchange = () => { rtSort = sort.value; store.set("rt.sort", rtSort); renderRetro(); };
    bar.append(shelf, sort);
  }
  function rtDupRow() {
    const d = (rtLib && rtLib.dups) || [];
    const r = mk("div", "rt-sync rt-dups");
    if (!d.length) { const tx = mk("div", "tx"); tx.append(mk("b", "", "No duplicate files"), mk("span", "", rtLib ? "Every game file is different." : "Checking…")); r.append(tx); return r; }
    const waste = d.reduce((n, x) => n + x.size * (x.files.length - 1), 0);
    const tx = mk("div", "tx"); tx.append(mk("b", "", d.length + " game" + (d.length > 1 ? "s have" : " has") + " identical copies"), mk("span", "", "Removing the extras frees about " + rtSize(waste)));
    r.append(tx);
    const list = mk("div", "rt-duplist");
    d.forEach(x => {
      list.append(mk("div", "rt-duph", x.title));
      x.files.forEach(f => { const row = mk("div", "rt-dir"); row.append(mk("span", "", f)); const b = mk("button", "linkbtn", "Show"); b.type = "button"; b.onclick = () => D.clipsShow(f); row.append(b); list.append(row); });
    });
    r.append(list);
    return r;
  }
  // details: what the game is, your time with it, every copy you have, and your shelves
  let rtDetKey = "";
  function rtDetail(key) {
    const g = rtGroups().find(x => x.key === key); if (!g) return;
    rtDetKey = key;
    const box = $("rtDet"); if (box.parentElement !== document.body) document.body.append(box); box.replaceChildren(); box.hidden = false;
    const card = mk("div", "rt-dcard");
    const x = mk("button", "ib rt-dx"); x.type = "button"; x.setAttribute("aria-label", "Close"); x.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    x.onclick = () => { box.hidden = true; rtDetKey = ""; };
    const top = mk("div", "rt-dtop"), art = mk("div", "rt-dart"), info = mk("div", "rt-dinfo");
    rtArt(g.main.token).then(u => { if (u) { const im = mk("img"); im.alt = ""; im.referrerPolicy = "no-referrer"; im.src = u; art.append(im); } });
    info.append(mk("div", "rt-dsys", [g.sys, g.year].filter(Boolean).join(" · ")), mk("h3", "", g.title));
    if (g.genre || g.dev) info.append(mk("div", "rt-dmeta", [g.genre, g.dev].filter(Boolean).join(" · ")));
    const stats = mk("div", "rt-dstats");
    [[g.st.time ? rtHrs(g.st.time) : "—", "played"], [g.st.plays || 0, g.st.plays === 1 ? "session" : "sessions"], [g.st.last ? new Date(g.st.last).toLocaleDateString([], { month: "short", day: "numeric" }) : "—", "last played"]].forEach(([v, k]) => { const s = mk("div"); s.append(mk("b", "", String(v)), mk("span", "", k)); stats.append(s); });
    info.append(stats);
    const acts = mk("div", "rt-dacts");
    const play = mk("button", "btn", "Play"); play.type = "button"; play.onclick = () => { box.hidden = true; rtPlayGame(rtAsGame(g.main)); };
    const done = mk("button", "btn ghost" + (g.st.done ? " on" : ""), g.st.done ? "✓ Finished" : "Mark finished"); done.type = "button";
    done.onclick = async () => { rtLib = Object.assign({}, rtLib, await D.libSet(g.key, { done: !g.st.done })); renderRetro(); rtDetail(key); };
    acts.append(play, done); info.append(acts);
    top.append(art, info);
    // copies
    const vs = mk("div", "rt-dsec"); vs.append(mk("div", "rt-dk", g.versions.length > 1 ? "Your copies" : "File"));
    g.versions.forEach(v => {
      const row = mk("div", "rt-ver" + (v.token === g.main.token ? " main" : "")), t = mk("div", "tx");
      const tag = v.patched ? "Patched / modified" : v.how === "crc" ? "Original" + (v.region ? " · " + v.region : "") : v.how === "name" ? "Matched by name" : "Not in the game list";
      t.append(mk("b", "", tag), mk("span", "", v.file + " · " + rtSize(v.size || 0) + (v.dup ? " · has an identical copy" : "")));
      t.title = v.path || v.file;
      const pb = mk("button", "linkbtn", "Play"); pb.type = "button"; pb.onclick = async () => { box.hidden = true; await D.libSet(g.key, { prefer: v.token }); rtPlayGame(rtAsGame(v)); };
      const sb = mk("button", "linkbtn", "Show"); sb.type = "button"; sb.onclick = () => D.clipsShow(v.path || (v.dir + "\\" + v.file));
      row.append(t, pb, sb); vs.append(row);
    });
    // shelves
    const cs = mk("div", "rt-dsec"); cs.append(mk("div", "rt-dk", "Shelves"));
    const chips = mk("div", "rt-dchips"), cols = ((rtLib && rtLib.cols) || []).map(c => ({ name: c.name, keys: c.keys.slice() }));
    const saveCols = async () => { const r = await D.libCols(cols); rtLib = Object.assign({}, rtLib, r); renderRetro(); rtDetail(key); };
    cols.forEach(c => {
      const on = c.keys.includes(g.key), b = mk("button", "chip", (on ? "✓ " : "+ ") + c.name); b.type = "button"; b.setAttribute("aria-pressed", on);
      b.onclick = () => { c.keys = on ? c.keys.filter(k => k !== g.key) : c.keys.concat(g.key); saveCols(); };
      b.oncontextmenu = e => { e.preventDefault(); if (confirm(`Delete the shelf "${c.name}"? Your games stay.`)) { cols.splice(cols.indexOf(c), 1); if (rtShelf === "col:" + c.name) { rtShelf = "all"; store.set("rt.shelf", "all"); } saveCols(); } };
      chips.append(b);
    });
    const nf = mk("form", "rt-newcol"), ni = mk("input"); ni.placeholder = "New shelf…"; ni.maxLength = 40; ni.spellcheck = false;
    nf.append(ni); nf.onsubmit = e => { e.preventDefault(); const n = ni.value.trim(); if (!n || cols.some(c => c.name.toLowerCase() === n.toLowerCase())) return; cols.push({ name: n, keys: [g.key] }); saveCols(); };
    chips.append(nf); cs.append(chips);
    if (cols.length) cs.append(mk("p", "hint", "Right-click a shelf to delete it."));
    card.append(x, top, vs, cs);
    box.append(card);
    box.onclick = e => { if (e.target === box) { box.hidden = true; rtDetKey = ""; } };
  }
  document.addEventListener("keydown", e => { if (e.key === "Escape" && $("rtDet") && !$("rtDet").hidden) { $("rtDet").hidden = true; rtDetKey = ""; } });
  async function rtAddDir() { if (await D.emuAddDir()) { rtDirsOpen = false; loadRetro(true); } }
  // Save backup: your saves and resume spots are copied to a folder (Dropbox by default) and come back if this PC loses them
  let rtSync = null;
  const rtAgo = t => { if (!t) return "not yet"; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "just now" : m < 60 ? m + " min ago" : new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); };
  function rtSyncRow() {
    const r = mk("div", "rt-sync"), tx = mk("div", "tx");
    const s = rtSync || { on: true, dir: "", last: 0 };
    tx.append(mk("b", "", "Back up saves" + (s.on ? " · last " + rtAgo(s.last) : " · off")), mk("span", "", s.err ? s.err : s.dir || "…"));
    tx.title = s.dir || "";
    const ch = mk("button", "linkbtn", "Change"); ch.type = "button"; ch.onclick = async () => { const v = await D.retroSyncDir(); if (v) { rtSync = v; renderRetro(); toast("Saves will back up there"); } };
    const op = mk("button", "linkbtn", "Open"); op.type = "button"; op.onclick = () => D.retroSyncOpen();
    const sw = mk("button", "switch"); sw.type = "button"; sw.setAttribute("role", "switch"); sw.setAttribute("aria-checked", !!s.on); sw.setAttribute("aria-label", "Back up retro saves");
    sw.onclick = async () => { rtSync = await D.retroSync({ on: !s.on }); renderRetro(); };
    r.append(tx, ch, op, sw);
    if (!rtSync) D.retroSync().then(v => { if (v) { rtSync = v; if (rtDirsOpen) renderRetro(); } }).catch(() => {});
    return r;
  }
  async function rtPickAzahar() { if (await D.emuPickAzahar()) loadRetro(true); }
  $("rtAdd").onclick = rtAddDir;
  $("gmQ").addEventListener("input", () => { if (gmMode === "retro") renderRetro(); else if (gmMode === "rel") relRender(); else if (gmMode === "mods") mo2Render(); });
  $("gmRef").onclick = () => gmMode === "retro" ? loadRetro(true) : gmMode === "rel" ? relLoad(true) : gmMode === "mods" ? mo2Load(true) : loadGames(true);
  /* ---------- Games → Mods: every Mod Organizer 2 setup on this PC; click one to open it ---------- */
  let mo2Data = null, mo2Busy = false;
  async function mo2Load(force) {
    if (mo2Busy) return; if (mo2Data && !force) return mo2Render();
    mo2Busy = true; $("gmRef").classList.add("spin"); if (!mo2Data) $("mo2Msg").textContent = "Looking for your Mod Organizer setups…";
    try { mo2Data = await D.mo2List(!!force); } catch { mo2Data = []; }
    mo2Busy = false; $("gmRef").classList.remove("spin"); mo2Render();
  }
  function mo2Render() {
    if (gmMode !== "mods") return;
    const q = $("gmQ").value.trim().toLowerCase(), list = (mo2Data || []).filter(x => !q || (x.name + " " + x.game).toLowerCase().includes(q));
    $("mo2Msg").hidden = !!list.length;
    $("mo2Msg").textContent = !mo2Data ? "Looking for your Mod Organizer setups…" : !mo2Data.length ? "No Mod Organizer 2 setups found. Make one in Mod Organizer, then press refresh." : "Nothing matches that.";
    $("mo2Grid").replaceChildren(...list.map(x => {
      const c = mk("div", "mo2-c"); c.setAttribute("role", "button"); c.tabIndex = 0; c.title = "Open " + x.name + " in Mod Organizer";
      const ic = mk("div", "mo2-ic"); if (x.icon) { const im = mk("img"); im.src = x.icon; im.alt = ""; ic.append(im); } else ic.textContent = (x.game[0] || "?").toUpperCase();
      const tx = mk("div", "mo2-tx"); tx.append(mk("b", "", x.name), mk("span", "", x.game + (x.name !== x.game ? "" : "") + " · " + x.mods + (x.mods === 1 ? " mod" : " mods") + (x.kind === "portable" ? " · portable" : "")));
      const fb = mk("button", "ib mo2-f"); fb.type = "button"; fb.title = "Open its folder"; fb.setAttribute("aria-label", "Open its folder");
      fb.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
      fb.onclick = e => { e.stopPropagation(); D.mo2Folder(x.id); };
      const go = mk("span", "mo2-go", "Open");
      c.append(ic, tx, fb, go);
      const open = async () => { c.classList.add("busy"); const r = await D.mo2Open(x.id).catch(() => null); c.classList.remove("busy"); toast(r && r.ok ? "Opening " + x.name : (r && r.err) || "Couldn't open it"); };
      c.onclick = open; c.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } };
      return c;
    }));
  }
  gmModeShow();


