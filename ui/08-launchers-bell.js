  /* ---------- Opera GX inside Sothis ---------- */
  const opRectNow = () => { const r = $("opArea").getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  let opSt = "";
  function opPaint() {
    const m = { starting: "Opening Opera GX…", embedded: "", noopera: "Couldn't find Opera GX on this PC.", failed: "Opera didn't open inside Sothis. Try again.", closed: "Opera was closed.", released: "Opera is in its own window now." }[opSt];
    $("opMsgT").textContent = m == null ? "Opening Opera GX…" : m;
    $("opAgain").hidden = !(opSt === "failed" || opSt === "closed" || opSt === "released");
    $("opOut").hidden = opSt !== "embedded";
    $("opSt").textContent = opSt === "embedded" ? "inside Sothis" : "";
  }
  async function opShow() { try { opSt = await D.operaShow(opRectNow()) || opSt; } catch {} opPaint(); }
  D.onOperaState(st => { opSt = st; opPaint(); if (st === "embedded" && tab === "opera") D.operaShow(opRectNow()); });
  $("opAgain").onclick = async () => { opSt = "starting"; opPaint(); await D.operaRestart(); if (tab === "opera") opShow(); };
  $("opOut").onclick = () => { D.operaRelease(); };
  try { new ResizeObserver(() => { if (tab === "opera") D.operaMove(opRectNow()); }).observe($("opArea")); } catch {}
  document.addEventListener("visibilitychange", () => { if (!document.hidden && tab === "opera") setTimeout(opShow, 200); });

  /* ---------- Discord inside Sothis: your real Discord app (same account, same calls), docked in its own page ---------- */
  const dkRect = () => { const r = $("dkArea").getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  let dkSt = "";
  function dkPaint() {
    const m = { starting: "Opening Discord…", embedded: "", noapp: "Couldn't find the Discord app on this PC.", failed: "Discord didn't open inside Sothis. Try again.",
      closed: "Discord was closed.", released: "Discord is in its own window now.", hidden: "Discord went to the tray." }[dkSt];
    $("dkMsgT").textContent = m == null ? "Opening Discord…" : m;
    $("dkAgain").hidden = !["failed", "closed", "released", "hidden"].includes(dkSt);
    $("dkOut").hidden = dkSt !== "embedded";
    $("dkSt").textContent = dkSt === "embedded" ? "your Discord app, inside Sothis" : "";
  }
  async function dkShow() { try { dkSt = await D.dockShow("discord", dkRect()) || dkSt; } catch {} dkPaint(); }
  D.onDockState(d => { if (!d || d.key !== "discord") return; dkSt = d.state; dkPaint(); if (d.state === "embedded" && tab === "dcapp") D.dockMove("discord", dkRect()); });
  $("dkAgain").onclick = async () => { dkSt = "starting"; dkPaint(); await D.dockRestart("discord"); if (tab === "dcapp") dkShow(); };
  $("dkOut").onclick = () => D.dockRelease("discord");
  try { new ResizeObserver(() => { if (tab === "dcapp") D.dockMove("discord", dkRect()); }).observe($("dkArea")); } catch {}
  document.addEventListener("visibilitychange", () => { if (!document.hidden && tab === "dcapp") setTimeout(dkShow, 200); });

  /* ---------- Launcher buttons (right corner column) ---------- */
  let lnList = [];
  const lnBell = mk("button", "cl-fab ln-bell bell-btn"); lnBell.type = "button"; lnBell.id = "bellBtnHome";
  lnBell.setAttribute("aria-label", "Notifications"); lnBell.setAttribute("aria-expanded", "false");
  lnBell.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg><i class="bell-dot" hidden></i>';
  $("launchCol").append(lnBell);
  async function renderLaunchers() {
    try { lnList = await D.launchList() || []; } catch { lnList = []; }
    const col = $("launchCol"); col.replaceChildren();
    lnList.forEach(l => {
      const b = mk("button", "cl-fab ln-b"); b.type = "button";
      b.setAttribute("aria-label", "Open " + l.name); b.setAttribute("aria-pressed", !!l.running);
      let ic;
      if (l.logo) { ic = mk("span", "glogo"); ic.dataset.logo = l.logo; }
      else if (l.icon) { ic = mk("img", "ln-img"); ic.src = l.icon; ic.alt = ""; }
      else { ic = mk("span", "ln-init", l.name.slice(0, 1)); }
      b.append(ic);
      b.onclick = async () => { const ok = await D.launchOpen(l.i); toast(ok ? "Opening " + l.name : "Couldn't open " + l.name); setTimeout(renderLaunchers, 2500); };
      col.append(b);
    });
    col.append(lnBell);
    renderLaunchSettings();
  }
  async function renderLaunchSettings() {
    const box = $("lnSet"); if (!box) return;
    box.replaceChildren();
    lnList.forEach((l, k) => {
      const row = mk("div", "ln-row");
      let ic;
      if (l.logo) { ic = mk("span", "glogo ln-ic"); ic.dataset.logo = l.logo; }
      else if (l.icon) { ic = mk("img", "ln-ic"); ic.src = l.icon; ic.alt = ""; }
      else ic = mk("span", "ln-ic ln-init", l.name.slice(0, 1));
      const up = mk("button", "ib ln-mv"); up.type = "button"; up.setAttribute("aria-label", "Move up"); up.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>';
      up.disabled = k === 0; up.onclick = () => D.launchMove(l.i, -1).then(renderLaunchers);
      const rm = mk("button", "ib ln-mv"); rm.type = "button"; rm.setAttribute("aria-label", "Remove " + l.name); rm.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
      rm.onclick = () => D.launchRemove(l.i).then(renderLaunchers);
      row.append(ic, mk("span", "ln-nm", l.name), up, rm);
      box.append(row);
    });
    if (!lnList.length) box.append(mk("p", "hint", "No apps pinned yet."));
    const pre = $("lnPresets"); pre.replaceChildren();
    let presets = []; try { presets = await D.launchPresets() || []; } catch {}
    presets.forEach(p => { const b = mk("button", "btn ghost ln-pre", "+ " + p.name); b.type = "button"; b.onclick = () => D.launchAddPreset(p.name).then(renderLaunchers); pre.append(b); });
  }
  $("lnAdd").onclick = () => D.launchAddFile().then(ok => { if (ok) renderLaunchers(); });
  setInterval(() => { if (!document.hidden) renderLaunchers(); }, 6000);
  setTimeout(renderLaunchers, 1500);

  /* ---------- Notification bell: history + volume mixer ---------- */
  let notes = []; try { notes = JSON.parse(store.get("notes") || "[]") || []; } catch {}
  let notesUnread = +(store.get("notes.unread") || 0), bellOpen = false;
  function note(kind, title, body, icon) {
    notes.unshift({ kind, title, body: body || "", icon: icon || "", at: Date.now() });
    notes = notes.slice(0, 60);
    store.set("notes", JSON.stringify(notes));
    if (!bellOpen) { notesUnread++; store.set("notes.unread", notesUnread); }
    renderBell();
  }
  window.__sothisNote = note;
  const KIND_IC = {
    discord: '<span class="glogo" data-logo="discord"></span>',
    server: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="m3 7 9 5 9-5M12 12v10"/></svg>',
    reminder: '<span class="glogo" data-logo="ow"></span>',
    battery: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 7v4"/></svg>',
    update: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>'
  };
  function renderBell() {
    $("bellDot").hidden = !notesUnread;
    const hd = document.querySelector("#bellBtnHome .bell-dot"); if (hd) hd.hidden = !notesUnread;
    if (!bellOpen) return;
    const list = $("bellList"); list.replaceChildren();
    if (!notes.length) { list.append(mk("p", "bell-empty", "Nothing yet. Mentions, reminders and server joins show up here.")); return; }
    notes.forEach(n => {
      const row = mk("div", "bell-row"), ic = mk("span", "bell-ic");
      if (n.icon) { const im = mk("img"); im.src = n.icon; im.alt = ""; im.referrerPolicy = "no-referrer"; ic.append(im); } else ic.innerHTML = KIND_IC[n.kind] || KIND_IC.update;
      const tx = mk("div", "bell-tx"); tx.append(mk("b", "", n.title), mk("span", "", n.body));
      row.append(ic, tx, mk("span", "bell-at", ago(n.at)));
      list.append(row);
    });
  }
  // Mixer
  let mixT = null, mixBusy = false;
  const PRETTY = { discord: "Discord", blackwall: "Blackwall", opera: "Opera GX", sothis: "Sothis", electron: "Sothis", overwatch: "Overwatch", cs2: "Counter-Strike 2", rainbowsix: "Rainbow Six Siege", "rainbowsix_vulkan": "Rainbow Six Siege", javaw: "Minecraft", steamwebhelper: "Steam", chrome: "Chrome", msedge: "Edge", spotify: "Spotify", medal: "Medal", obs64: "OBS" };
  const pretty = n => PRETTY[String(n).toLowerCase()] || n.replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  async function renderMixer() {
    if (mixBusy) return; mixBusy = true;
    let list = null; try { list = await D.mixList(); } catch {}
    mixBusy = false;
    const box = $("mixList");
    if (!list) { box.replaceChildren(mk("p", "bell-empty", "Couldn't read Windows' volume mixer.")); return; }
    if (document.activeElement && document.activeElement.classList.contains("mix-in")) return;   // don't redraw under your finger
    box.replaceChildren();
    list = list.filter(a => !/^(svchost|cider)(\.exe)?$/i.test(a.name));   // hide Windows service host and the old Cider app
    list.sort((a, b) => (b.self - a.self) || (a.name === "System sounds") - (b.name === "System sounds") || pretty(a.name).localeCompare(pretty(b.name)));
    list.forEach(a => {
      const row = mk("div", "mix-row" + (a.mute ? " muted" : ""));
      const ic = mk("button", "mix-ic"); ic.type = "button"; ic.setAttribute("aria-label", (a.mute ? "Unmute " : "Mute ") + pretty(a.name));
      if (a.icon) { const im = mk("img"); im.src = a.icon; im.alt = ""; ic.append(im); } else ic.textContent = pretty(a.name).slice(0, 1);
      ic.onclick = () => D.mixMute(a.name, !a.mute).then(renderMixer);
      const nm = mk("span", "mix-nm", a.self ? "Sothis (music)" : pretty(a.name));
      const r = mk("input", "mix-in"); r.type = "range"; r.min = 0; r.max = 100; r.value = Math.round(a.vol * 100); r.setAttribute("aria-label", pretty(a.name) + " volume");
      const out = mk("span", "mix-v", Math.round(a.vol * 100) + "");
      r.style.setProperty("--p", r.value + "%");
      r.oninput = () => { out.textContent = r.value; r.style.setProperty("--p", r.value + "%"); clearTimeout(mixT); mixT = setTimeout(() => D.mixSet(a.name, r.value / 100), 60); };
      r.onchange = () => { r.blur(); };
      const top = mk("div", "mix-top"); top.append(nm, out);
      const col = mk("div", "mix-col"); col.append(top, r);
      row.append(ic, col);
      box.append(row);
    });
  }
  let mixPoll = null, sndOpen = false;
  function bellShow(open) {
    bellOpen = open;
    const pop = $("bellPop"), home = document.body.classList.contains("on-home");
    pop.hidden = !open; $("bellBtn").setAttribute("aria-expanded", open); $("bellBtnHome").setAttribute("aria-expanded", open);
    if (open && home) { const r = $("bellBtnHome").getBoundingClientRect(); pop.style.top = "auto"; pop.style.bottom = Math.round(innerHeight - r.top + 6) + "px"; }
    else { pop.style.top = ""; pop.style.bottom = ""; }
    if (open) { notesUnread = 0; store.set("notes.unread", 0); }
    renderBell();
  }
  function sndShow(open) {
    sndOpen = open;
    $("sndPop").hidden = !open; $("sndBtn").setAttribute("aria-expanded", open);
    clearInterval(mixPoll);
    if (open) { renderMixer(); mixPoll = setInterval(renderMixer, 3000); }
  }
  $("bellBtn").onclick = $("bellBtnHome").onclick = e => { e.stopPropagation(); bellShow(!bellOpen); };
  $("sndBtn").onclick = e => { e.stopPropagation(); sndShow(!sndOpen); };
  document.addEventListener("mousedown", e => {
    if (bellOpen && !$("bellPop").contains(e.target) && !$("bellBtn").contains(e.target) && !$("bellBtnHome").contains(e.target)) bellShow(false);
    if (sndOpen && !$("sndPop").contains(e.target) && !$("sndBtn").contains(e.target)) sndShow(false);
  });
  document.addEventListener("keydown", e => { if (e.key !== "Escape") return; if (bellOpen) bellShow(false); if (sndOpen) sndShow(false); });
  $("bellClear").onclick = () => { notes = []; store.set("notes", "[]"); renderBell(); };
  renderBell();

  /* ---------- Server join/leave alerts ---------- */
  let mcPrev = null, mcAlerts = store.get("mc.alerts") !== "0";
  function mcAlert(text) {
    note("server", text, MC.addr);
    if (document.hidden) return;
    const stack = $("dcnStack"), c = mk("div", "dcn"), ic = mk("span", "bell-ic"); ic.innerHTML = KIND_IC.server; ic.style.cssText = "width:30px;height:30px;color:#3ccf8e";
    const tx = mk("div"); tx.append(mk("b", "", text), mk("span", "", MC.addr));
    c.append(ic, tx);
    const bye = () => { c.classList.add("out"); setTimeout(() => c.remove(), 260); };
    c.onclick = bye; stack.prepend(c); setTimeout(bye, 6000);
  }
  function mcDiff(r) {
    if (!r || !r.online || !Array.isArray(r.names)) { if (r && !r.online) mcPrev = null; return; }
    const now = new Set(r.names);
    if (mcPrev && mcAlerts && r.names.length >= Math.min(r.players, 12)) {
      for (const n of now) if (!mcPrev.has(n)) mcAlert(n + " joined");
      for (const n of mcPrev) if (!now.has(n)) mcAlert(n + " left");
    }
    mcPrev = now;
  }
  $("setMcAlerts").setAttribute("aria-checked", mcAlerts);
  $("setMcAlerts").onclick = () => { mcAlerts = !mcAlerts; store.set("mc.alerts", mcAlerts ? "1" : "0"); $("setMcAlerts").setAttribute("aria-checked", mcAlerts); };

  /* ---------- Splash ---------- */
  (function splash() {
    const sp = $("splash");
    const end = () => {
      document.body.classList.remove("splashing"); try { tabPill(); } catch {}
      sp.classList.add("out");
      setTimeout(() => sp.remove(), 800);
    };
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    // The mini player gets a shorter version (decided once the window state is known)
    D.getWindow().then(w => setTimeout(end, reduced ? 600 : (w && w.mini ? 2800 : 3000)), () => setTimeout(end, 3000));
  })();

  D.onNav(d => { if (tab === "ytm") $(d === "back" ? "ytBack" : "ytFwd").click(); });
  document.addEventListener("keydown", e => { if (tab !== "ytm" || !e.altKey) return; if (e.key === "ArrowLeft") { e.preventDefault(); $("ytBack").click(); } else if (e.key === "ArrowRight") { e.preventDefault(); $("ytFwd").click(); } });

