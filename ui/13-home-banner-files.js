  /* ---------- Home banner ---------- */
  const HX_LOGO = { "Overwatch 2": "ow", "Rainbow Six Siege": "r6", "Counter-Strike 2": "cs" };
  let hxLive = null, hxImgKey = "", hxIdleArt = null;
  function hxSetImg(srcs) {
    const key = srcs.join("|"), im = $("hxBg");
    if (key === hxImgKey) return;
    hxImgKey = key;
    im.classList.remove("on"); $("hx").classList.remove("has-bg");
    const list = srcs.filter(Boolean);
    const next = i => {
      if (i >= list.length || hxImgKey !== key) { im.removeAttribute("src"); return; }
      const t = new Image(); t.referrerPolicy = "no-referrer";
      t.onload = () => { if (hxImgKey !== key) return; im.src = list[i]; requestAnimationFrame(() => { im.classList.add("on"); $("hx").classList.add("has-bg"); }); };
      t.onerror = () => next(i + 1);
      t.src = list[i];
    };
    next(0);
  }
  function hxRender() {
    const L = hxLive, hx = $("hx");
    if (L) {
      hx.dataset.state = "live";
      $("hxKt").textContent = "Playing now · " + dur(Date.now() - L.start);
      $("hxT").textContent = L.game;
      $("hxS").textContent = [L.map, L.mode, L.rank].filter(Boolean).join(" · ") || "Have a good one";
      const lg = HX_LOGO[L.game]; $("hxLogo").hidden = !lg; if (lg) $("hxLogo").dataset.logo = lg;
      hxSetImg([...(Array.isArray(L.art) ? L.art : [L.art]), L.mapImg]);   // the game's Steam banner first; the map picture only if there's no banner
      $("hxHero").hidden = L.game !== "Overwatch 2";
      if (L.game === "Overwatch 2") hxHeroFill();
      $("hxWd").hidden = !/^wardogs\b/i.test(L.game || "");
      if (!$("hxWd").hidden) hxWdFill(); else $("hxWdSt").hidden = true;
      $("hxPins").hidden = true;
    } else {
      $("hxHero").hidden = true; hxHeroClose(); $("hxWd").hidden = true; $("hxWdSt").hidden = true;
      if ($("hxPins").hidden || $("hxPins").childElementCount !== gmPins.length) hxPinsFill();
      $("hxPins").hidden = !gmPins.length;
      hx.dataset.state = "idle";
      const d = new Date(), h = d.getHours();
      $("hxKt").textContent = h < 5 ? "Up late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
      $("hxT").textContent = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      $("hxS").textContent = d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
      $("hxLogo").hidden = true;
      hxSetImg([]);   // between games: the plain red banner
    }
  }
  // Overwatch: tell Sothis which hero you're on (it learns your skin's picture for next time); heroes grouped by role
  let hxHeroList = null, hxHeroCur = "";
  const HX_ROLES = [["tank", "Tank", "#4a9eff"], ["damage", "Damage", "#ff5a6e"], ["support", "Support", "#5fd38d"]];
  async function hxHeroFill() {
    let cur = null; try { cur = await D.owHero(); } catch {}
    hxHeroCur = cur && cur.name || "";
    $("hxHeroT").textContent = hxHeroCur || "Which hero?";
  }
  async function hxHeroOpen() {
    if (!hxHeroList || !hxHeroList.length) { try { hxHeroList = (await D.owHeroes() || []).filter(h => h && h.name); } catch { hxHeroList = []; } }
    const box = $("hxPopRoles"); box.replaceChildren();
    if (!hxHeroList.length) { box.append(mk("div", "fr-msg", "Couldn't load the hero list. Check your internet and try again.")); }
    HX_ROLES.forEach(([k, label, col]) => {
      const list = hxHeroList.filter(h => String(h.role).toLowerCase() === k).sort((a, b) => a.name.localeCompare(b.name));
      if (!list.length) return;
      const r = mk("div", "hxp-role"); r.style.setProperty("--rc", col);
      const h4 = mk("h4"); h4.append(mk("i"), document.createTextNode(label)); r.append(h4);
      const g = mk("div", "hxp-grid");
      list.forEach(h => {
        const b = mk("button", "hxp-h" + (h.name === hxHeroCur ? " on" : "")); b.type = "button"; b.title = h.name;
        const im = mk("img"); im.alt = ""; im.loading = "lazy"; if (httpsUrl(h.portrait)) im.src = h.portrait;
        b.append(im, document.createTextNode(h.name));
        b.onclick = () => hxHeroPick(h.name);
        g.append(b);
      });
      r.append(g); box.append(r);
    });
    $("hxPop").hidden = false; $("hxHero").setAttribute("aria-expanded", "true");
  }
  function hxHeroClose() { $("hxPop").hidden = true; $("hxHero").setAttribute("aria-expanded", "false"); }
  async function hxHeroPick(n) {
    hxHeroClose();
    let r = null; try { r = await D.owHeroSet(n); } catch {}
    hxHeroCur = n; $("hxHeroT").textContent = n;
    toast(r && r.learned ? "Got it. Sothis will spot " + n + " (with this skin) by itself next time" : n + " set. Pick it while in a match and Sothis learns its picture");
    hxPoll();
  }
  $("hxHero").onclick = e => { e.stopPropagation(); if ($("hxPop").hidden) hxHeroOpen(); else hxHeroClose(); };
  $("hxPopX").onclick = hxHeroClose;
  document.addEventListener("click", e => { if (!$("hxPop").hidden && !$("hxPop").contains(e.target) && !$("hxHero").contains(e.target)) hxHeroClose(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("hxPop").hidden) hxHeroClose(); });
  // Wardogs: three team buttons (tap the lit one again to clear it)
  const HX_WD = [["lonestar", "Lonestar", "#5ab4f0"], ["valkyra", "Valkyra", "#e0474f"], ["manticore", "Manticore", "#2fbf2f"]];
  async function hxWdFill() {
    let cur = ""; try { cur = (await D.wdTeam()) || ""; } catch {}
    const box = $("hxWd");
    if (!box.childElementCount) HX_WD.forEach(([k, name, col]) => {
      const b = mk("button"); b.type = "button"; b.dataset.k = k; b.style.setProperty("--tc", col); b.title = "I'm on " + name;
      const im = mk("img"); im.src = "wd-" + k + ".png"; im.alt = ""; b.append(im, document.createTextNode(name));
      b.onclick = async () => { const on = b.classList.contains("on"); try { await D.wdTeamSet(on ? "" : k); } catch {} hxWdFill(); };
      box.append(b);
    });
    box.querySelectorAll("button").forEach(b => { const on = b.dataset.k === cur; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); });
    // earnings: this match, best match, this week
    let st = null; try { st = await D.wdStats(); } catch {}
    const el = $("hxWdSt"); el.replaceChildren();
    const money = v => { const s = mk("b", v < 0 ? "dn" : "up", (v < 0 ? "-" : "+") + "$" + Math.abs(v).toLocaleString("en-US")); return s; };
    const part = (label, v) => { const sp = mk("span", "", label + " "); sp.append(money(v)); el.append(sp); };
    if (st) { if (st.now != null) part("This match", st.now); if (st.best != null) part("Best", st.best); if (st.weekMatches) part(`This week (${st.weekMatches})`, st.week); }
    el.hidden = !el.childElementCount;
  }
  // Quick notes on Home (kept in this PC's app storage)
  // Notes: shared with the phone remote (kept in a file on this PC, so both sides see the same note)
  { const ta = $("hmNotes"); let t = null, dirty = false;
    const flash = m => { $("hmNotesSaved").textContent = m; clearTimeout(flash.t); flash.t = setTimeout(() => { $("hmNotesSaved").textContent = ""; }, 1800); };
    ta.value = store.get("home.notes") || "";
    D.notesGet().then(n => {
      if (n && n.fresh && ta.value) D.notesSet(ta.value).catch(() => {});   // first run: move the note that was kept in this window
      else if (n && !dirty) ta.value = n.text || "";
    }).catch(() => {});
    ta.addEventListener("input", () => { dirty = true; clearTimeout(t); $("hmNotesSaved").textContent = "…"; t = setTimeout(async () => { const v = ta.value.slice(0, 20000); store.set("home.notes", v); try { await D.notesSet(v); } catch {} dirty = false; flash("Saved"); }, 500); });
    D.onNotes(n => { if (!n || dirty) return; if (ta.value !== n.text) { const a = ta.selectionStart, b = ta.selectionEnd; ta.value = n.text || ""; store.set("home.notes", ta.value); if (document.activeElement === ta) { try { ta.setSelectionRange(Math.min(a, ta.value.length), Math.min(b, ta.value.length)); } catch {} } flash("Updated from phone"); } }); }
  // Backup / restore (passwords and secrets are left out by Sothis itself)
  $("bkSave").onclick = async () => {
    const local = {}; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); local[k] = localStorage.getItem(k); } } catch {}
    let r = null; try { r = await D.backupExport(local); } catch {}
    if (r && r.ok) toast("Backup saved: " + r.file); else if (!(r && r.canceled)) toast((r && r.err) || "Couldn't save the backup");
  };
  $("bkLoad").onclick = async () => {
    let r = null; try { r = await D.backupImport(); } catch {}
    if (!r || r.canceled) return;
    if (!r.ok) { toast(r.err || "Couldn't restore that backup"); return; }
    try { for (const [k, v] of Object.entries(r.local || {})) localStorage.setItem(k, v); } catch {}
    toast("Backup restored. Reloading…"); setTimeout(() => location.reload(), 900);
  };
  // Settings: tabs at the top, one per section; only the picked section shows
  { const nav = $("setNav"), panel = $("tab-settings"), chips = [];
    nav.setAttribute("role", "tablist");
    const groups = [...panel.querySelectorAll(".group")].filter(g => g.querySelector(":scope > h2"));
    const pick = (g, save) => {
      groups.forEach((x, i) => { const on = x === g; x.classList.toggle("set-off", !on); chips[i].classList.toggle("on", on); chips[i].setAttribute("aria-selected", on); });
      if (save) store.set("set.tab", g.querySelector(":scope > h2").textContent.trim());
      panel.scrollTop = 0;
      const c = chips[groups.indexOf(g)]; if (c) c.scrollIntoView({ block: "nearest", inline: "nearest" });
    };
    groups.forEach(g => {
      const b = mk("button", "chip", g.querySelector(":scope > h2").textContent.trim()); b.type = "button"; b.setAttribute("role", "tab");
      b.onclick = () => pick(g, true);
      g.addEventListener("settab", () => pick(g, true));
      chips.push(b); nav.append(b);
    });
    const last = store.get("set.tab");
    pick(groups.find(g => g.querySelector(":scope > h2").textContent.trim() === last) || groups[0], false);
  }
  /* ---------- One icon set: every text button gets a matching outline icon (by its label) ---------- */
  const IC = {
    x: '<path d="M6 6l12 12M18 6 6 18"/>', check: '<path d="M5 12.5 10 17 19 7"/>', plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>', search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-3.8-3.8"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>', ext: '<path d="M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
    play: '<path d="M8 5v14l11-7z"/>', down: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>', up: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
    start: '<path d="M6 4v16M10 12h10M14 8l-4 4 4 4"/>', end: '<path d="M18 4v16M14 12H4M10 8l4 4-4 4"/>',
    split: '<circle cx="6" cy="7" r="3"/><circle cx="6" cy="17" r="3"/><path d="M8.5 8.5 20 18M8.5 15.5 20 6"/>',
    reset: '<path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.5M4 3.5v5h5"/>', power: '<path d="M12 3v8M6.3 6.8a8 8 0 1 0 11.4 0"/>',
    save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>', star: '<path d="M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8 6.6 19.7l1.1-6.1L3.2 9.4l6.1-.8z"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z"/>',
    full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>', test: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>', mute: '<path d="M11 5 6 9H3v6h3l5 4zM16 9l5 6M21 9l-5 6"/>'
  };
  const IC_LABEL = [
    [/^(cancel|close|clear|dismiss)$/i, "x"], [/^(done|pick it|claimed|got it)$/i, "check"], [/^(save|save changes)$/i, "save"],
    [/^(delete|remove|remove friend|remove part|sure\? click again)$/i, "trash"], [/^(add|add it|add a friend|add photos|add an app…|\+ add friend|create)$/i, "plus"],
    [/^(find|search)$/i, "search"], [/^connect$/i, "link"], [/^(change|edit|edit accounts)$/i, "edit"], [/^(pop out|open it|open|view)$/i, "ext"],
    [/^(show|preview)$/i, "eye"], [/^play$/i, "play"], [/^(download mp4|download|save backup|save as new clip)$/i, "down"], [/^restore$/i, "up"],
    [/^start$/i, "start"], [/^end$/i, "end"], [/^split$/i, "split"], [/^(reset|try again|refresh)$/i, "reset"], [/^(turn off)$/i, "power"],
    [/^fullscreen$/i, "full"], [/^test in 3 seconds$/i, "test"], [/^(cheats)$/i, "gear"], [/^(mute for me)$/i, "mute"], [/^set up the recorder$/i, "down"]
  ];
  function icDecorate(root) {
    (root || document).querySelectorAll("button.btn, button.wbtn").forEach(b => {
      if (b.querySelector(".bi, svg, img")) return;
      const t = (b.textContent || "").trim();
      if (t === "×") { b.innerHTML = '<span class="bi"><svg viewBox="0 0 24 24">' + IC.x + '</svg></span>'; b.classList.add("ib-only"); return; }
      const hit = IC_LABEL.find(([re]) => re.test(t)); if (!hit) return;
      const sp = document.createElement("span"); sp.className = "bi"; sp.setAttribute("aria-hidden", "true");
      sp.innerHTML = '<svg viewBox="0 0 24 24">' + IC[hit[1]] + '</svg>';
      b.prepend(sp);
    });
  }
  icDecorate();
  { let icT = null; new MutationObserver(() => { clearTimeout(icT); icT = setTimeout(() => icDecorate(), 120); }).observe(document.body, { childList: true, subtree: true }); }
  async function hxPoll() {
    try { hxLive = await D.sessionLive(); } catch { hxLive = null; }
    hxRender();
  }
  hxPoll();
  setInterval(() => { if (tab === "home") hxPoll(); }, 15000);
  setInterval(() => { if (tab === "home") hxRender(); }, 5000);
  D.onSession(() => setTimeout(hxPoll, 400));

  /* ---------- Files: music (MP3), ROMs, and the downloader ---------- */
  var fmNow = null;
  let fmItems = [];
  const fa = $("fmAudio");
  const ICON_NOTE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>';
  // drag a file out of Sothis into Discord, a folder or any app
  function fileDrag(el, f) {
    if (!f) return el;
    el.title = (el.title ? el.title + "\n" : "") + "Drag into Discord or a folder";
    el.draggable = false;
    // press and move the mouse a little: Windows takes over the drag from there (buttons can't start a normal web drag)
    let start = null, dragged = false;
    el.addEventListener("pointerdown", e => { if (e.button === 0) { start = { x: e.clientX, y: e.clientY }; dragged = false; } });
    el.addEventListener("pointermove", e => {
      if (!start || !(e.buttons & 1)) { start = null; return; }
      if (Math.abs(e.clientX - start.x) + Math.abs(e.clientY - start.y) < 8) return;
      start = null; dragged = true;
      try { D.dragFile(f); } catch {}
    });
    el.addEventListener("pointerup", () => { start = null; });
    el.addEventListener("click", e => { if (dragged) { dragged = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
    el.addEventListener("dragstart", e => e.preventDefault());
    return el;
  }
  function fmRow(icon, title, sub, onPlay, acts, on) {
    const r = mk("div", "fm-row" + (on ? " on" : "")); r.tabIndex = 0;
    const ic = mk("div", "fm-ic"); if (icon.startsWith("<")) ic.innerHTML = icon; else ic.textContent = icon;
    const tx = mk("div", "fm-tx"); tx.append(mk("b", "", title), mk("span", "", sub));
    const a = mk("div", "fm-acts");
    acts.forEach(([label, fn, cls]) => {
      const b = mk("button", cls || "", label); b.type = "button";
      b.onclick = e => {
        e.stopPropagation();
        if (cls === "del") {
          if (!b.classList.contains("sure")) { b.classList.add("sure"); b.textContent = "Sure?"; setTimeout(() => { b.classList.remove("sure"); b.textContent = label; }, 3000); return; }
        }
        fn();
      };
      a.append(b);
    });
    r.append(ic, tx, a);
    r.onclick = onPlay; r.onkeydown = e => { if (e.key === "Enter") onPlay(); };
    return r;
  }
  const delFile = async (f, after) => {
    let r = null; try { r = await D.filesDelete(f); } catch {}
    toast(r && r.ok ? "Moved to the Recycle Bin" : (r && r.err) || "Couldn't delete that");
    after();
  };
  async function loadMusic() {
    let r = null; try { r = await D.filesList("mp3"); } catch {}
    $("clDir").textContent = r ? r.dir : "";
    fmItems = (r && r.items) || [];
    const msg = !r ? "Couldn't read your music folder." : !fmItems.length ? "No music yet. Paste a link above to download a song as MP3." : "";
    $("clMsg").textContent = msg; $("clMsg").hidden = !msg;
    fmRender();
  }
  function fmRender() {
    if (flKind !== "mp3") return;
    const list = $("fmList"); list.replaceChildren();
    fmItems.forEach(it => list.append(fileDrag(fmRow(it.ext === "mp3" ? ICON_NOTE : it.ext.toUpperCase(), it.name, [ago(it.at), fmtSize(it.size), it.ext.toUpperCase()].join(" · "),
      () => fmPlay(it), [["Show", () => D.clipsShow(it.path)], ["Delete", () => { if (fmNow && fmNow.path === it.path) fmStop(); delFile(it.path, loadMusic); }, "del"]], fmNow && fmNow.path === it.path), it.path)));
    $("fmPlay").hidden = !fmNow;
  }
  function fmPlay(it) {
    if (fmNow && fmNow.path === it.path) { fa.paused ? fa.play().catch(() => {}) : fa.pause(); return; }
    try { const n = nowInfo(); if (n && n.playing) M.mPlay.onclick(); } catch {}   // pause YouTube Music so they don't play over each other
    fmNow = it; fa.src = it.url; fa.play().catch(() => {});
    $("fmTitle").textContent = it.name; fmRender();
  }
  function fmStop() { fa.pause(); fa.removeAttribute("src"); fa.load(); fmNow = null; fmRender(); }
  const fmStep = d => { if (!fmItems.length) return; const i = fmNow ? fmItems.findIndex(x => x.path === fmNow.path) : -1; fmPlay(fmItems[(i + d + fmItems.length) % fmItems.length]); };
  $("fmPP").onclick = () => { if (!fmNow) return fmItems[0] && fmPlay(fmItems[0]); fa.paused ? fa.play().catch(() => {}) : fa.pause(); };
  $("fmPrev").onclick = () => fa.currentTime > 3 ? (fa.currentTime = 0) : fmStep(-1);
  $("fmNext").onclick = () => fmStep(1);
  fa.addEventListener("ended", () => fmStep(1));
  const fmTick = () => {
    $("fmPPi").setAttribute("d", fa.paused ? "M8 5v14l11-7z" : "M7 5h4v14H7zM13 5h4v14h-4z");
    $("fmPP").setAttribute("aria-label", fa.paused ? "Play" : "Pause");
    $("fmCur").textContent = fmtDur(fa.currentTime || 0); $("fmDur").textContent = fmtDur(fa.duration || 0);
    if (!$("fmSeek").matches(":active") && fa.duration) $("fmSeek").value = Math.round(fa.currentTime / fa.duration * 1000);
  };
  ["timeupdate", "play", "pause", "loadedmetadata"].forEach(ev2 => fa.addEventListener(ev2, fmTick));
  $("fmSeek").addEventListener("input", () => { if (fa.duration) fa.currentTime = $("fmSeek").value / 1000 * fa.duration; });

  function fmArt(g, row) {
    D.emuArt(g.token).then(u => {
      if (!u) return;
      const ic = row.querySelector(".fm-ic"), im = mk("img"); im.alt = ""; im.referrerPolicy = "no-referrer";
      im.onload = () => { ic.replaceChildren(im); ic.classList.add("art"); }; im.src = u;
    }).catch(() => {});
    return row;
  }
  async function loadRomList() {
    let r = null; try { r = await D.emuList(); } catch {}
    $("clDir").textContent = r && r.dirs && r.dirs.length ? r.dirs.join("  ·  ") : "No game folders yet";
    const items = (r && r.items) || [];
    const msg = !r ? "Couldn't read your game folders." : !items.length ? "No game files found. Add a folder in Games → Retro → Folders." : "";
    $("clMsg").textContent = msg; $("clMsg").hidden = !msg;
    const list = $("fmList"); list.replaceChildren();
    items.forEach(g => list.append(fmArt(g, fmRow(g.sys.length > 4 ? g.sys.slice(0, 3).toUpperCase() : g.sys.toUpperCase(), g.name, [g.sys, fmtSize(g.size || 0), g.azahar ? "Opens in Azahar" : "Plays in Sothis"].join(" · "),
      () => rtPlayGame(g),
      [["Play", () => rtPlayGame(g)], ["Show", () => D.clipsShow(g.dir + "\\" + g.file)], ["Delete", () => delFile(g.dir + "\\" + g.file, loadRomList), "del"]]))));
  }

  // Downloader
  const dlJobs = new Map();
  function dlRender() {
    const box = $("dlList"); box.replaceChildren();
    [...dlJobs.values()].slice(-6).reverse().forEach(j => {
      const r = mk("div", "fl-qi" + (j.state === "done" ? " done" : j.state === "error" ? " error" : ""));
      r.append(mk("b", "", j.title || "Download"));
      const right = mk("div");
      if (["queued", "running", "setup", "finishing"].includes(j.state)) { const c = mk("button", "linkbtn", "Cancel"); c.type = "button"; c.onclick = () => D.dlCancel(j.id); right.append(c); }
      else if (j.state === "done" || j.state === "error" || j.state === "cancelled") { const c = mk("button", "linkbtn", "Clear"); c.type = "button"; c.onclick = () => { dlJobs.delete(j.id); dlRender(); }; right.append(c); }
      r.append(right);
      const st = j.state === "queued" ? "Waiting…" : j.state === "setup" ? "Setting up the downloader (one time)…" : j.state === "running" ? `${Math.round(j.pct || 0)}%` + (j.eta && j.eta !== "NA" ? ` · ${j.eta} left` : "") :
        j.state === "finishing" ? (j.fmt === "mp3" ? "Turning it into an MP3…" : "Putting the video together…") : j.state === "done" ? "Saved" : j.state === "cancelled" ? "Cancelled" : (j.err || "Didn't work");
      const sp = mk("span", "", (j.fmt ? j.fmt.toUpperCase() + " · " : "") + st); sp.style.gridColumn = "span 2"; r.append(sp);
      if (j.state !== "error" && j.state !== "cancelled") { const bar = mk("div", "bar"), i = mk("i"); i.style.width = (j.state === "finishing" ? 100 : j.pct || 0) + "%"; bar.append(i); r.append(bar); }
      box.append(r);
    });
  }
  D.onDl(d => {
    const j = Object.assign(dlJobs.get(d.id) || {}, d);
    dlJobs.set(d.id, j); dlRender();
    if (d.state === "done") { toast("Downloaded " + (j.title || "")); if (tab === "clips" && flKind === j.fmt) loadClips(); }
    if (d.state === "error") toast(d.err || "The download didn't work");
  });
  $("flDl").onsubmit = async e => {
    e.preventDefault();
    const url = $("dlUrl").value.trim(); if (!url) return;
    const fmt = flKind === "mp3" ? "mp3" : "mp4";
    const r = await D.dlStart({ url, fmt }).catch(() => ({ ok: false }));
    if (r.ok) { $("dlUrl").value = ""; dlJobs.set(r.id, Object.assign(dlJobs.get(r.id) || {}, { id: r.id, fmt, state: (dlJobs.get(r.id) || {}).state || "queued", title: (dlJobs.get(r.id) || {}).title || url })); dlRender(); }
    else toast(r.err || "Couldn't start that download");
  };

  /* ---------- Discord idle status ---------- */
  let dcIdleOn = true;
  D.dcIdle().then(v => { dcIdleOn = v !== false; $("setDcIdle").setAttribute("aria-checked", dcIdleOn); }).catch(() => {});
  let dcNameOn = true;
  D.dcNameOnly().then(v => { dcNameOn = v !== false; $("setDcName").setAttribute("aria-checked", dcNameOn); }).catch(() => {});
  $("setDcName").onclick = () => D.dcNameOnly(!dcNameOn).then(v => { dcNameOn = v; $("setDcName").setAttribute("aria-checked", dcNameOn); });
  $("setDcIdle").onclick = () => D.dcIdle(!dcIdleOn).then(v => { dcIdleOn = v; $("setDcIdle").setAttribute("aria-checked", dcIdleOn); });
  // Discord mute / deafen hotkeys: click a key button, then press the new combination (Esc cancels)
  let dhkCfg = null, dhkRec = "";
  const dhkPaint = (msg) => {
    if (!dhkCfg) return;
    $("setDkOn").setAttribute("aria-checked", String(!!dhkCfg.on));
    $("setDkMute").textContent = dhkRec === "mute" ? "Press keys…" : "Mute: " + (dhkCfg.mute || "none");
    $("setDkDeaf").textContent = dhkRec === "deaf" ? "Press keys…" : "Deafen: " + (dhkCfg.deaf || "none");
    $("setDkDesc").textContent = msg || "Mute or deafen in Discord from anywhere, even inside a game. A small pop-up shows which way it went. Click a key to change it.";
  };
  const dhkSave = async patch => { let r = null; try { r = await D.dcKeysSet(patch); } catch {} if (r) dhkCfg = r; dhkRec = ""; dhkPaint(r && r.failed && r.failed.length ? "Another app is already using " + r.failed.map(w => r[w]).join(" and ") + ". Pick a different key." : ""); };
  D.dcKeysGet().then(r => { dhkCfg = r; dhkPaint(); }).catch(() => {});
  $("setDkOn").onclick = () => dhkSave({ on: !(dhkCfg && dhkCfg.on) });
  $("setDkMute").onclick = () => { dhkRec = "mute"; dhkPaint("Press the new mute keys (with Ctrl, Alt or Shift). Esc cancels."); };
  $("setDkDeaf").onclick = () => { dhkRec = "deaf"; dhkPaint("Press the new deafen keys (with Ctrl, Alt or Shift). Esc cancels."); };
  window.addEventListener("keydown", e => {
    if (!dhkRec) return;
    e.preventDefault(); e.stopPropagation();
    if (e.key === "Escape") { dhkRec = ""; dhkPaint(); return; }
    if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return;
    const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift"].filter(Boolean);
    let k = e.code.startsWith("Key") ? e.code.slice(3) : e.code.startsWith("Digit") ? e.code.slice(5) : /^F\d{1,2}$/.test(e.key) ? e.key : e.code.startsWith("Numpad") ? "num" + e.code.slice(6).toLowerCase() : ({ Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Backslash: "\\", Insert: "Insert", Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown", Pause: "Pause" })[e.code];
    if (!k) return;
    if (!mods.length && !/^F\d{1,2}$/.test(k)) { dhkPaint("Use Ctrl, Alt or Shift with a key (or an F key on its own) so it doesn't fire while you type."); return; }
    dhkSave({ [dhkRec]: [...mods, k].join("+") });
  }, true);

  // Crunchyroll: the browser extension sends the episode and its time; without it, only the episode number from the window title
  const crDescBase = "Shows the show, season and episode (like S1 E4) and the episode's time bar while you watch. Needs the small Sothis extension in the browser you watch in.";
  let crHelpUntil = 0;
  async function crPaint() {
    let st = null; try { st = await D.crStatus(); } catch {}
    if (Date.now() < crHelpUntil && !(st && st.ext)) return;
    $("setCrDesc").textContent = st && st.ext ? "Extension connected" + (st.now && st.now.show ? " · watching " + st.now.show : "") + ". Your Discord status shows the season, episode and time." : crDescBase;
    $("setCrExt").textContent = st && st.ext ? "Open folder" : "Set up";
  }
  $("setCrExt").onclick = async () => {
    let r = null; try { r = await D.crExt(); } catch {}
    crHelpUntil = Date.now() + 5 * 60000;
    $("setCrDesc").textContent = r && r.ok
      ? "The extension folder just opened. In your browser go to its Extensions page (chrome://extensions, opera://extensions or edge://extensions), turn on Developer mode, click Load unpacked and pick that folder. Then open an episode on Crunchyroll."
      : "Couldn't copy the extension" + (r && r.err ? " (" + r.err + ")" : "") + ".";
  };
  crPaint(); setInterval(() => { if (tab === "settings") crPaint(); }, 10000);

  /* ---------- Retro games inside Sothis (muted while you're on another tab) ---------- */
  let rtNow = null, rtWv = null, rtFullOn = false;
  const rtJs = (code, ms = 4000) => !rtWv ? Promise.resolve(null) : Promise.race([rtWv.executeJavaScript(code).catch(() => null), new Promise(r => setTimeout(() => r(null), ms))]);
  function rtHostMute(on) {
    if (!rtWv) return;
    try { rtWv.setAudioMuted(on); } catch {}
    $("rtMuted").hidden = !on;
    if (on) rtJs("window.sothisSave && window.sothisSave()");   // keep your spot when you look away
    else setTimeout(() => { try { rtWv.focus(); } catch {} }, 120);
  }
  function rtFull(on) {
    rtFullOn = !!on;
    document.body.classList.toggle("rt-full", rtFullOn);
    D.fullscreen(rtFullOn);
    rtJs(`window.__sothisSetFull && window.__sothisSetFull(${rtFullOn})`, 1000);
    setTimeout(() => { try { rtWv && rtWv.focus(); } catch {} }, 150);
  }
  D.onFull(on => { if (!on && rtFullOn) { rtFullOn = false; document.body.classList.remove("rt-full"); rtJs("window.__sothisSetFull && window.__sothisSetFull(false)", 1000); } });
  async function rtPlayGame(g) {
    if (rtNow) await rtStop();
    const r = await D.emuPlay(g.token).catch(() => ({ ok: false }));
    if (!r || !r.ok) return toast((r && r.err) || "Couldn't start it");
    if (!r.inline) return toast("Starting " + g.name);
    rtNow = g; window.__rtPlaying = true;
    $("rtPlayT").textContent = g.name.replace(/\s*[\(\[].*$/, "") || g.name; $("rtPlaySys").textContent = g.sys;
    const wv = rtWv = document.createElement("webview");
    wv.setAttribute("partition", "persist:emu");
    wv.setAttribute("src", r.url + "&inline=1");
    wv.addEventListener("console-message", e => { const m = /^SOTHIS:full:(\d)$/.exec(e.message || ""); if (m) rtFull(m[1] === "1"); });
    wv.addEventListener("dom-ready", () => setTimeout(() => { try { wv.focus(); } catch {} }, 300));
    $("rtHost").replaceChildren(wv);
    chtFoundList = []; chtPack = null; $("chtPacks").replaceChildren(); $("chtFound").replaceChildren();
    wv.addEventListener("did-finish-load", () => setTimeout(() => { try { chtRender(); } catch {} }, 4000));
    $("gmView").hidden = true; $("rtPlay").hidden = false; $("rtMuted").hidden = true; $("tab-games").classList.add("playing");
    if (tab !== "games") showTab("games");   // retro games play at the Home size too
    D.emuInline(g.name + " (" + g.sys + ")");
    D.libPlaying(g.token);
  }
  async function rtStop() {
    if (!rtNow) return;
    if (rtFullOn) rtFull(false);
    await rtJs("window.sothisLeave ? window.sothisLeave() : true", 5000);   // save your game and your spot first
    try { await Promise.race([D.retroBackupNow(), new Promise(r => setTimeout(r, 4000))]); } catch {}   // then copy it to your backup folder
    $("rtHost").replaceChildren(); rtWv = null;
    rtNow = null; window.__rtPlaying = false;
    $("rtPlay").hidden = true; $("gmView").hidden = false; $("tab-games").classList.remove("playing");
    if (tab === "games") D.setLayout("main");
    D.emuInline(null);
    D.libPlaying(null);
    if (rtLib) setTimeout(() => loadLib(), 400);
  }
  $("rtBack").onclick = () => rtStop();
  $("rtClose").onclick = () => rtStop();
  $("rtPop").onclick = async () => { const g = rtNow; if (!g) return; await rtStop(); D.emuPlay(g.token, "window"); };
  $("rtFull").onclick = () => rtFull(true);
  $("rtUnfull").onclick = () => rtFull(false);
  $("rtHost").addEventListener("mouseenter", () => { if (tab === "games" && rtWv) try { rtWv.focus(); } catch {} });
  // save your spot if Sothis reloads for an update or closes
  window.addEventListener("beforeunload", () => { if (rtWv) try { rtWv.executeJavaScript("window.sothisLeave && window.sothisLeave()"); } catch {} });

  /* ---------- Cheat panel for the game you're playing ---------- */
  let chtFoundList = [], chtPack = null;
  const chtRow = (desc, code, right) => { const r = mk("div", "cht-row"), tx = mk("div", "tx"); tx.append(mk("b", "", desc), mk("span", "", code.replace(/\+/g, " · "))); tx.title = desc + "\n" + code.replace(/\+/g, "\n"); r.append(tx, ...right); return r; };
  async function chtRender() {
    if ($("cht").hidden) return;
    const list = (await rtJs("window.sothisCheats ? window.sothisCheats() : []", 3000)) || [];
    const box = $("chtList"); box.replaceChildren();
    if (!list.length) box.append(mk("div", "cht-empty", "No cheats yet. Add a code, or find ready-made ones below."));
    list.forEach(c => {
      const sw = mk("button", "switch"); sw.type = "button"; sw.setAttribute("role", "switch"); sw.setAttribute("aria-checked", c.on); sw.setAttribute("aria-label", "Turn " + c.desc + (c.on ? " off" : " on"));
      sw.onclick = async () => { await rtJs(`window.sothisCheatSet(${c.i}, ${!c.on})`); chtRender(); };
      const x = mk("button", "x", "×"); x.type = "button"; x.title = "Remove"; x.onclick = async () => { await rtJs(`window.sothisCheatDel(${c.i})`); chtRender(); chtFoundRender(); };
      box.append(chtRow(c.desc, c.code, [sw, x]));
    });
    chtFoundRender(list);
  }
  async function chtFoundRender(have) {
    const box = $("chtFound"); box.replaceChildren();
    if (!chtFoundList.length) return;
    have = have || (await rtJs("window.sothisCheats ? window.sothisCheats() : []", 3000)) || [];
    const codes = new Set(have.map(c => c.code));
    chtFoundList.forEach(c => {
      const added = codes.has(c.code);
      const b = mk("button", "plus" + (added ? " done" : ""), added ? "✓" : "+"); b.type = "button"; b.title = added ? "Added" : "Add to your cheats";
      if (!added) b.onclick = async () => { await rtJs(`window.sothisCheatAdd(${JSON.stringify(c.desc)}, ${JSON.stringify(c.code)}, false)`); chtRender(); };
      box.append(chtRow(c.desc, c.code, [b]));
    });
  }
  async function chtLoadPack(p) {
    chtPack = p; [...$("chtPacks").children].forEach(ch => ch.setAttribute("aria-pressed", ch.dataset.n === p.name));
    $("chtFound").replaceChildren(mk("div", "cht-empty", "Downloading cheats…"));
    const r = await D.cheatGet(p).catch(() => ({ ok: false }));
    chtFoundList = r && r.ok ? r.list : [];
    if (!r || !r.ok) $("chtFound").replaceChildren(mk("div", "cht-empty", (r && r.err) || "Couldn't download the cheats."));
    else chtFoundRender();
  }
  $("chtFind").onclick = async () => {
    if (!rtNow) return;
    $("chtPacks").replaceChildren(); $("chtFound").replaceChildren(mk("div", "cht-empty", "Looking…"));
    const packs = await D.cheatFind(rtNow.token).catch(() => []);
    if (!packs.length) { $("chtFound").replaceChildren(mk("div", "cht-empty", "No ready-made cheats found for this game. You can still add codes yourself.")); return; }
    packs.forEach(p => { const c = mk("button", "chip", p.name.replace(/^.*?\s*\(/, "(")); c.type = "button"; c.dataset.n = p.name; c.title = p.name; c.onclick = () => chtLoadPack(p); $("chtPacks").append(c); });
    $("chtPacks").hidden = packs.length < 2;
    chtLoadPack(packs[0]);
  };
  $("chtAdd").onclick = async () => {
    const name = $("chtName").value.trim() || "My cheat";
    const code = $("chtCode").value.split(/\r?\n/).map(l => l.trim()).filter(Boolean).join("+");
    if (!code) return toast("Paste a cheat code first");
    const ok = await rtJs(`window.sothisCheatAdd(${JSON.stringify(name)}, ${JSON.stringify(code)}, true)`);
    if (ok === false) return toast("That code is already in your list");
    $("chtName").value = ""; $("chtCode").value = ""; chtRender(); toast("Cheat added and on");
  };
  $("rtCheatBtn").onclick = () => { const open = $("cht").hidden; $("cht").hidden = !open; $("rtCheatBtn").setAttribute("aria-pressed", open); if (open) chtRender(); };

  /* ---------- Compact sidebar ---------- */
  (function railTabs() {
    const box = $("rlTabs");
    [["home", "Home"], ["ytm", "Music"], ["games", "Games"], ["stats", "Stats"], ["switch", "Switch"]].forEach(([k, label]) => {
      const src = $("tabbtn-" + k); if (!src) return;
      const b = mk("button", "rl-tab"); b.type = "button"; b.title = label; b.setAttribute("aria-label", "Open " + label);
      b.innerHTML = src.innerHTML;
      b.onclick = async () => { await D.setCompact(false); showTab(k); };
      box.append(b);
    });
  })();
  $("compactBtn").onclick = () => D.setCompact(true);
  $("rlExpand").onclick = () => D.setCompact(false);
  $("rlClose").onclick = () => D.close();
  $("rlNext").onclick = () => M.mNext.onclick();
  $("rlArt").onclick = () => M.mPlay.onclick();
  $("rlClip").onclick = async () => {
    const b = $("rlClip"); let r = null; try { r = await D.medalClip(); } catch {}
    if (r && r.ok) { b.classList.add("done"); setTimeout(() => b.classList.remove("done"), 2500); } else toast((r && r.err) || "Couldn't save a clip");
  };
  const RL_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>', RL_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';
  function railTick() {
    if (!w_compact) return;
    let n = null; try { n = nowInfo(); } catch {}
    const art = n && n.art;
    if (art) { if ($("rlArtImg").getAttribute("src") !== art) $("rlArtImg").src = art; } else $("rlArtImg").removeAttribute("src");
    $("rlArt").classList.toggle("playing", !!(n && n.playing)); $("rlArt").classList.toggle("paused", !!(n && !n.playing));
    $("rlPP").innerHTML = n && n.playing ? RL_PAUSE : RL_PLAY;
    $("rlArt").title = n ? (n.title || "Unknown song") + (n.artist ? " — " + n.artist : "") : "Nothing playing";
  }
  setInterval(railTick, 1000);
  function railDc(st) {
    const box = $("rlFaces"); box.replaceChildren();
    const ch = st && st.status === "ok" && st.channel;
    if (!ch) return;
    const list = ch.members.slice().sort((a, b) => (b.speaking - a.speaking) || (b.me - a.me));
    list.slice(0, 5).forEach(m => { const im = mk("img", m.speaking ? "talk" : ""); im.alt = ""; im.title = m.name; im.referrerPolicy = "no-referrer"; if (m.avatar) im.src = m.avatar; box.append(im); });
    if (list.length > 5) box.append(mk("span", "rl-more", "+" + (list.length - 5)));
  }
  D.onDc(railDc); D.dcGet().then(railDc).catch(() => {});

  showTab(tab);
  setTimeout(ensureYTM, 3800);  // load YouTube Music in the background once the splash is done
