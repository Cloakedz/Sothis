  /* ---------- Clip button on Home (Sothis's own recorder) ---------- */
  $("hmClip").onclick = async () => {
    const b = $("hmClip"); b.classList.add("busy");
    let r = null; try { r = await D.medalClip(); } catch {}
    b.classList.remove("busy");
    if (r && r.ok) { clipBurst(b); b.classList.add("done"); b.querySelector("span").textContent = "Clipped!"; setTimeout(() => { b.classList.remove("done"); b.querySelector("span").textContent = "Clip it"; }, 2500); }
    else toast((r && r.err) || "Couldn't save a clip");
  };
  function clipBurst(btn) {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    [0, 180].forEach(d => setTimeout(() => { const r = mk("span", "clip-ring"); btn.append(r); setTimeout(() => r.remove(), 1000); }, d));
    const from = $("hx"), to = $("hmClipDir"); if (!from || !to || from.offsetParent === null) return;
    const a = from.getBoundingClientRect(), z = to.getBoundingClientRect();
    const f = mk("div", "clip-fly"); const bg = $("hxBg").getAttribute("src");
    if (bg) f.style.backgroundImage = `url("${bg}"), linear-gradient(160deg, #57202f, #1d1018)`;
    Object.assign(f.style, { left: a.left + "px", top: a.top + "px", width: a.width + "px", height: a.height + "px", opacity: ".9" });
    document.body.append(f);
    requestAnimationFrame(() => requestAnimationFrame(() => { f.style.transform = `translate(${z.left + z.width / 2 - a.left - 6}px, ${z.top + z.height / 2 - a.top - 4}px) scale(${12 / a.width}, ${8 / a.height})`; f.style.opacity = "0"; }));
    setTimeout(() => { f.remove(); to.classList.remove("bump"); void to.offsetWidth; to.classList.add("bump"); }, 1000);
  }
  $("hmClipDir").onclick = () => { try { flKind = "clips"; store.set("fl.kind", "clips"); } catch {} showTab("clips"); };

  /* ---------- Clips page (your Medal folder) ---------- */
  const fmtSize = b => b > 1e9 ? (b / 1e9).toFixed(1) + " GB" : Math.round(b / 1e6) + " MB";
  const fmtDur = s => !isFinite(s) ? "" : Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
  let clipsLast = null;
  let flKind = ["clips", "roms", "mp3", "mp4", "photos", "shots"].includes(store.get("fl.kind")) ? store.get("fl.kind") : "clips";
  function loadClips() {
    document.querySelectorAll("#flMode button").forEach(b => b.setAttribute("aria-checked", b.dataset.k === flKind));
    const vids = flKind === "clips" || flKind === "mp4", shots = flKind === "shots", pics = flKind === "photos" || shots;
    $("clGrid").hidden = !vids; $("fmList").hidden = vids || pics; $("phGrid").hidden = !pics; $("phBar").hidden = flKind !== "photos";
    $("phDel").hidden = shots; $("clChoose").hidden = shots; $("clOpen").hidden = shots;
    if (!pics) phClose();
    if (!vids && !$("clPlay").hidden) $("clClose").click();
    $("flDl").hidden = !(flKind === "mp3" || flKind === "mp4");
    $("dlGo").textContent = flKind === "mp3" ? "Download MP3" : "Download MP4";
    $("fmPlay").hidden = flKind !== "mp3" || !fmNow;
    $("clWhere").textContent = shots ? "From Steam, Xbox Game Bar, Windows, NVIDIA / AMD and game photo modes." : flKind === "clips" ? "Clips are saved here." : flKind === "roms" ? "These come from your Retro game folders." : flKind === "mp3" ? "Music downloads go here." : pics ? "Your photos live here." : "Video downloads go here.";
    $("clDiff").hidden = flKind === "roms" || flKind === "shots";
    if (vids) return loadClipGrid();
    if (flKind === "mp3") return loadMusic();
    if (shots) return loadShots();
    if (pics) return loadPhotos();
    return loadRomList();
  }
  /* Photos: a picture folder kept by Sothis, with a viewer */
  let phItems = [], phAt = -1;
  async function loadPhotos() {
    let r = null; try { r = await D.filesList("photos"); } catch {}
    const grid = $("phGrid"); grid.replaceChildren();
    $("clDir").textContent = r ? r.dir : "";
    phItems = (r && r.items) || [];
    const msg = !r ? "Couldn't read your photos folder." : !phItems.length ? "No photos yet. Add some, or drag pictures in from File Explorer." : "";
    $("clMsg").textContent = msg; $("clMsg").hidden = !msg;
    phItems.forEach((p, i) => {
      const b = mk("button", "phc"); b.type = "button"; b.title = p.name; b.setAttribute("aria-label", p.name);
      const im = mk("img"); im.loading = "lazy"; im.decoding = "async"; im.alt = ""; im.src = p.url;
      b.append(im); b.onclick = () => phOpen(i); fileDrag(b, p.path);
      grid.append(b);
    });
    if (phAt >= 0) { if (phItems.length) phOpen(Math.min(phAt, phItems.length - 1)); else phClose(); }
  }
  // Screenshots: every game screenshot on this PC, newest first, grouped by game (same viewer as Photos)
  let shotGame = "";
  async function loadShots() {
    const grid = $("phGrid"); grid.replaceChildren(mk("p", "lyp-msg", "Looking for screenshots…"));
    let list = null; try { list = await D.shotsList(); } catch {}
    if (flKind !== "shots") return;
    grid.replaceChildren(); $("clDir").textContent = "";
    const all = list || [];
    const games = [...new Set(all.map(x => x.game))];
    if (shotGame && !games.includes(shotGame)) shotGame = "";
    phItems = shotGame ? all.filter(x => x.game === shotGame) : all;
    const msg = !list ? "Couldn't look for screenshots." : !all.length ? "No screenshots yet. Take one in a game (Steam: F12, Xbox Game Bar: Win+Alt+PrtScn) and press refresh." : "";
    $("clMsg").textContent = msg; $("clMsg").hidden = !msg;
    if (games.length > 1) {
      const bar = mk("div", "sh-games");
      const chip = (label, g) => { const c = mk("button", "chip" + (shotGame === g ? " on" : ""), label); c.type = "button"; c.onclick = () => { shotGame = g; loadShots(); }; return c; };
      bar.append(chip("All (" + all.length + ")", ""), ...games.map(g => chip(g + " (" + all.filter(x => x.game === g).length + ")", g)));
      grid.append(bar);
    }
    let last = "";
    phItems.forEach((p, i) => {
      if (!shotGame && p.game !== last) { last = p.game; grid.append(mk("div", "sh-h", p.game)); }
      const b = mk("button", "phc"); b.type = "button"; b.title = p.game + " · " + p.name; b.setAttribute("aria-label", p.name);
      const im = mk("img"); im.loading = "lazy"; im.decoding = "async"; im.alt = ""; im.src = p.url;
      b.append(im); b.onclick = () => phOpen(i); fileDrag(b, p.path);
      grid.append(b);
    });
  }
  function phOpen(i) {
    if (!phItems.length) return phClose();
    phAt = (i + phItems.length) % phItems.length;
    const p = phItems[phAt];
    $("phImg").src = p.url; $("phName").textContent = p.name;
    $("phMeta").textContent = [p.game || "", ago(p.at), p.size < 1e6 ? Math.max(1, Math.round(p.size / 1e3)) + " KB" : fmtSize(p.size), (phAt + 1) + " of " + phItems.length].filter(Boolean).join(" · ");
    $("phPrev").hidden = $("phNext").hidden = phItems.length < 2;
    $("phDel").dataset.sure = ""; $("phDel").textContent = "Delete";
    $("phBox").hidden = false;
  }
  function phClose() { phAt = -1; const bx = $("phBox"); if (bx) { bx.hidden = true; $("phImg").removeAttribute("src"); } }
  $("phPrev").onclick = () => phOpen(phAt - 1);
  $("phNext").onclick = () => phOpen(phAt + 1);
  $("phClose").onclick = phClose;
  $("phBox").addEventListener("click", e => { if (e.target === e.currentTarget || e.target.classList.contains("ph-st")) phClose(); });
  $("phShow").onclick = () => { if (phAt >= 0) D.clipsShow(phItems[phAt].path); };
  $("phDel").onclick = async () => {
    if (phAt < 0) return;
    const b = $("phDel");
    if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Sure? Click again"; setTimeout(() => { b.dataset.sure = ""; b.textContent = "Delete"; }, 3000); return; }
    b.dataset.sure = ""; b.textContent = "Delete";
    let r = null; try { r = await D.filesDelete(phItems[phAt].path); } catch {}
    toast(r && r.ok ? "Moved to the Recycle Bin" : (r && r.err) || "Couldn't delete that photo");
    loadPhotos();
  };
  document.addEventListener("keydown", e => {
    if ($("phBox").hidden) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); phClose(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); phOpen(phAt - 1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); phOpen(phAt + 1); }
  }, true);
  const phAdded = r => { if (r && r.added) { toast(`Added ${r.added} photo${r.added === 1 ? "" : "s"}`); loadPhotos(); } else if (r && r.skipped) toast("Those files aren't pictures Sothis can keep"); };
  $("phAdd").onclick = async () => { let r = null; try { r = await D.photosAdd(); } catch {} phAdded(r); };
  // drag pictures in from File Explorer anywhere on the Photos page
  const phDropOk = e => tab === "clips" && flKind === "photos" && e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");
  $("tab-clips").addEventListener("dragover", e => { if (!phDropOk(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; $("phBar").classList.add("over"); });
  $("tab-clips").addEventListener("dragleave", e => { if (!e.relatedTarget || !$("tab-clips").contains(e.relatedTarget)) $("phBar").classList.remove("over"); });
  $("tab-clips").addEventListener("drop", async e => {
    $("phBar").classList.remove("over");
    if (!phDropOk(e)) return;
    e.preventDefault();
    let r = null; try { r = await D.photosAddFiles(e.dataTransfer.files); } catch {}
    phAdded(r);
  });
  async function loadClipGrid() {
    let r = null; try { r = flKind === "mp4" ? await D.filesList("mp4") : await D.clipsList(); } catch {}
    const grid = $("clGrid"); grid.replaceChildren();
    $("clDir").textContent = r ? r.dir : "";
    const msg = !r ? "Couldn't read that folder." : !r.exists ? "That folder doesn't exist yet. Save a clip first, or pick another folder." : !r.items.length ? (flKind === "mp4" ? "No videos yet. Paste a link above to download one." : "No clips yet. Hit Clip it on Home while you play.") : "";
    $("clMsg").textContent = msg; $("clMsg").hidden = !msg;
    clipsLast = r;
    (r && r.items || []).forEach(c => {
      const b = mk("button", "clc"); b.type = "button";
      const th = mk("div", "th"), v = mk("video"); v.muted = true; v.preload = "metadata"; v.src = c.url + "#t=1";
      const du = mk("span", "du"); v.onloadedmetadata = () => { du.textContent = fmtDur(v.duration); };
      th.append(v, du);
      const tx = mk("div", "tx"); tx.append(mk("b", "", c.name), mk("span", "", [c.game, ago(c.at), fmtSize(c.size)].filter(Boolean).join(" · ")));
      const x = mk("span", "x"); x.setAttribute("role", "button"); x.setAttribute("aria-label", "Delete " + c.name);
      const TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';
      x.innerHTML = TRASH;
      x.onclick = ev2 => {
        ev2.stopPropagation();
        if (!x.classList.contains("sure")) { x.classList.add("sure"); x.textContent = "Delete?"; setTimeout(() => { x.classList.remove("sure"); x.innerHTML = TRASH; }, 3000); return; }
        deleteClip(c);
      };
      b.append(x, th, tx);
      b.onclick = () => playClip(c);
      fileDrag(b, c.path);
      grid.append(b);
    });
  }
  let clipNow = null;
  /* Clip editor: keep parts of a clip, then save a new file (the original is never changed) */
  let edSegs = [], edSel = 0, edDur = 0, edBusy = false, edDrag = null;
  const ev = $("clVid");
  const fmtT = t => Math.floor(t / 60) + ":" + (t % 60).toFixed(1).padStart(4, "0");
  const segAt = t => edSegs.findIndex(x => t >= x.a - 0.02 && t <= x.b + 0.02);
  function edRender() {
    const box = $("edSegs"); box.replaceChildren();
    if (!edDur) return;
    edSegs.forEach((x, i) => {
      const d = mk("div", "ed-seg" + (i === edSel ? " sel" : "")); d.style.left = (x.a / edDur * 100) + "%"; d.style.width = ((x.b - x.a) / edDur * 100) + "%";
      // drag either edge to trim this part
      for (const side of ["l", "r"]) { const h = mk("i", "ed-h " + side + (edDrag && edDrag.i === i && edDrag.side === side ? " drag" : "")); h.dataset.i = i; h.dataset.side = side; h.title = side === "l" ? "Drag to trim the start" : "Drag to trim the end"; d.append(h); }
      box.append(d);
    });
    $("edPh").style.left = (ev.currentTime / edDur * 100) + "%";
    $("edTime").textContent = fmtT(ev.currentTime) + " / " + fmtT(edDur);
    const keep = edSegs.reduce((n, x) => n + x.b - x.a, 0);
    $("edLen").textContent = `${edSegs.length} part${edSegs.length === 1 ? "" : "s"} · ${fmtT(keep)} kept`;
    $("edQuick").disabled = edSegs.length !== 1; if (edSegs.length !== 1) $("edQuick").checked = false;
    $("edDel").disabled = edSegs.length < 2;
    $("edPlayI").setAttribute("d", ev.paused ? "M8 5v14l11-7z" : "M7 5h4v14H7zM13 5h4v14h-4z");
  }
  function edReset() { edSegs = edDur ? [{ a: 0, b: edDur }] : []; edSel = 0; edRender(); }
  ev.addEventListener("loadedmetadata", () => { edDur = ev.duration || 0; edReset(); });
  // while playing, skip the parts you removed
  (function edTick() {
    if (!ev.paused && edDur && edSegs.length) {
      const t = ev.currentTime, i = segAt(t);
      if (i < 0) { const nx = edSegs.find(x => x.a > t); if (nx) ev.currentTime = nx.a; else ev.pause(); }
      edRender();
    }
    requestAnimationFrame(edTick);
  })();
  ev.addEventListener("pause", edRender); ev.addEventListener("play", edRender); ev.addEventListener("seeked", () => { const i = segAt(ev.currentTime); if (i >= 0) edSel = i; edRender(); });
  $("edPlay").onclick = () => { if (ev.paused) { if (segAt(ev.currentTime) < 0 || ev.currentTime >= edDur - 0.05) ev.currentTime = edSegs.length ? edSegs[0].a : 0; ev.play().catch(() => {}); } else ev.pause(); };
  ev.onclick = () => $("edPlay").click();
  const tlSeek = e => { const r = $("edTl").getBoundingClientRect(); ev.currentTime = Math.max(0, Math.min(edDur, (e.clientX - r.left) / r.width * edDur)); const i = segAt(ev.currentTime); if (i >= 0) edSel = i; edRender(); };
  const tlTime = e => { const r = $("edTl").getBoundingClientRect(); return Math.max(0, Math.min(edDur, (e.clientX - r.left) / r.width * edDur)); };
  // dragging a part's edge trims it (it can't pass the part next to it, and keeps at least 0.1 s); the video follows the edge
  const edgeMove = e => {
    if (!edDrag) return; const x = edSegs[edDrag.i]; if (!x) return;
    const t = tlTime(e), i = edDrag.i;
    if (edDrag.side === "l") x.a = Math.max(i ? edSegs[i - 1].b : 0, Math.min(t, x.b - 0.1));
    else x.b = Math.min(i < edSegs.length - 1 ? edSegs[i + 1].a : edDur, Math.max(t, x.a + 0.1));
    ev.currentTime = edDrag.side === "l" ? x.a : Math.max(x.a, x.b - 0.03);
    edRender();
  };
  $("edTl").addEventListener("pointerdown", e => {
    $("edTl").setPointerCapture(e.pointerId);
    const h = e.target.closest(".ed-h");
    if (h && edDur) { edDrag = { i: +h.dataset.i, side: h.dataset.side }; edSel = edDrag.i; ev.pause(); edgeMove(e); $("edTl").onpointermove = edgeMove; return; }
    tlSeek(e); $("edTl").onpointermove = tlSeek;
  });
  const tlUp = () => { $("edTl").onpointermove = null; if (edDrag) { edDrag = null; edRender(); } };
  $("edTl").addEventListener("pointerup", tlUp); $("edTl").addEventListener("pointercancel", tlUp);
  const cur = () => { const i = segAt(ev.currentTime); return i >= 0 ? i : edSel; };
  $("edIn").onclick = () => { const i = cur(), x = edSegs[i], t = ev.currentTime; if (x && t < x.b - 0.1) { x.a = Math.max(t, i ? edSegs[i - 1].b : 0); edSel = i; edRender(); } };
  $("edOut").onclick = () => { const i = cur(), x = edSegs[i], t = ev.currentTime; if (x && t > x.a + 0.1) { x.b = Math.min(t, i < edSegs.length - 1 ? edSegs[i + 1].a : edDur); edSel = i; edRender(); } };
  $("edSplit").onclick = () => { const t = ev.currentTime, i = segAt(t); if (i < 0) return; const x = edSegs[i]; if (t - x.a < 0.1 || x.b - t < 0.1) return; edSegs.splice(i, 1, { a: x.a, b: t }, { a: t, b: x.b }); edSel = i + 1; edRender(); };
  $("edDel").onclick = () => { if (edSegs.length < 2) return; edSegs.splice(edSel, 1); edSel = Math.min(edSel, edSegs.length - 1); edRender(); };
  $("edReset").onclick = edReset;
  D.onClipsProgress(p => { $("edProgI").style.width = p + "%"; });
  $("edSave").onclick = async () => {
    if (!clipNow || edBusy || !edSegs.length) return;
    edBusy = true; ev.pause(); $("edSave").disabled = true; $("edSave").textContent = "Saving…"; $("edProg").hidden = false; $("edProgI").style.width = "0%";
    let r = null; try { r = await D.clipsExport({ file: clipNow.path, segs: edSegs, quick: $("edQuick").checked, gameVol: edVol("game"), micVol: edVol("mic"), voiceVol: edVol("voice") }); } catch {}
    edBusy = false; $("edSave").disabled = false; $("edSave").textContent = "Save as new clip"; $("edProg").hidden = true;
    if (r && r.ok) { toast("Saved " + r.name); loadClips(); } else toast((r && r.err) || "Couldn't save the clip");
  };
  document.addEventListener("keydown", e => {
    if (tab !== "clips" || $("clPlay").hidden || e.target.matches("input, textarea, select")) return;
    const k = e.key.toLowerCase();
    if (k === " ") { e.preventDefault(); $("edPlay").click(); }
    else if (k === "i") $("edIn").click(); else if (k === "o") $("edOut").click(); else if (k === "s") $("edSplit").click();
    else if (k === "delete" || k === "backspace") $("edDel").click();
    else if (k === "f") $("edFull").click();
    else if (k === "arrowleft") { ev.currentTime = Math.max(0, ev.currentTime - (e.shiftKey ? 1 : 1 / 30)); edRender(); }
    else if (k === "arrowright") { ev.currentTime = Math.min(edDur, ev.currentTime + (e.shiftKey ? 1 : 1 / 30)); edRender(); }
  });
  // fullscreen for the clip editor (F, or the button; Esc leaves)
  let edFullWin = false;
  $("edFull").onclick = () => { const el = $("clPlay"); try { if (document.fullscreenElement) document.exitFullscreen(); else el.requestFullscreen().catch(() => toast("Couldn't go fullscreen")); } catch {} };
  document.addEventListener("fullscreenchange", () => {
    const on = document.fullscreenElement === $("clPlay");
    // the Sothis window itself fills the screen too (it can't go fullscreen on its own)
    if (on !== !!edFullWin) { edFullWin = on; try { D.fullscreen(on); } catch {} }
    $("edFull").setAttribute("aria-pressed", on); $("edFull").title = on ? "Exit fullscreen (F or Esc)" : "Fullscreen (F)";
    $("edFullI").setAttribute("d", on ? "M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5" : "M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5");
  });
  $("clClose").addEventListener("click", () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); });
  // sound in the editor: game and mic volume (separately on Sothis clips that kept a mic track)
  const edA = { game: 100, mic: 100, voice: 100, gameMute: false, micMute: false, voiceMute: false, tracks: [""] };
  const edVol = k => edA[k + "Mute"] ? 0 : edA[k] / 100;
  function edAudRender() {
    $("edAud").hidden = !edA.tracks.length;
    $("edMicW").hidden = !edA.tracks.includes("Mic");
    $("edVoiceW").hidden = !edA.tracks.includes("Discord");
    for (const k of ["game", "mic", "voice"]) {
      const K = k === "game" ? "Game" : k === "mic" ? "Mic" : "Voice";
      $("ed" + K).value = edA[k]; $("ed" + K + "V").textContent = edA[k] + "%"; $("ed" + K).disabled = edA[k + "Mute"];
      $("ed" + K + "Mute").setAttribute("aria-pressed", edA[k + "Mute"]); $("ed" + K + "Mute").textContent = edA[k + "Mute"] ? "Muted" : "Mute";
    }
    // the preview plays the clip's mixed sound; turn it down with the game slider so you can hear roughly how it'll be
    try { $("clVid").volume = Math.min(1, edVol("game")); } catch {}
    if (edVol("game") !== 1 || edVol("mic") !== 1 || edVol("voice") !== 1) { $("edQuick").checked = false; $("edQuick").disabled = true; }
  }
  for (const k of ["game", "mic", "voice"]) {
    const K = k === "game" ? "Game" : k === "mic" ? "Mic" : "Voice";
    $("ed" + K).addEventListener("input", () => { edA[k] = +$("ed" + K).value; edAudRender(); });
    $("ed" + K + "Mute").onclick = e => { e.preventDefault(); edA[k + "Mute"] = !edA[k + "Mute"]; edAudRender(); };
  }
  function playClip(c) {
    clipNow = c; edDur = 0; edSegs = [];
    Object.assign(edA, { game: 100, mic: 100, voice: 100, gameMute: false, micMute: false, voiceMute: false, tracks: [""] }); edAudRender();
    D.clipsTracks(c.path).then(t => { if (clipNow === c) { edA.tracks = Array.isArray(t) ? t : []; edAudRender(); } }).catch(() => {});
    $("clPlay").hidden = false; $("clVid").src = c.url; $("clVid").play().catch(() => {});
    $("clPlayName").textContent = c.name; $("clPlayMeta").textContent = [c.game, ago(c.at), fmtSize(c.size)].filter(Boolean).join(" · ");
    $("tab-clips").scrollTop = 0;
  }
  $("clClose").onclick = () => { $("clVid").pause(); $("clVid").removeAttribute("src"); $("clVid").load(); $("clPlay").hidden = true; clipNow = null; };
  $("clShow").onclick = () => { if (clipNow) D.clipsShow(clipNow.path); };
  async function deleteClip(c) {
    if (clipNow && clipNow.path === c.path) $("clClose").click();
    let r = null; try { r = await D.clipsDelete(c.path); } catch {}
    toast(r && r.ok ? "Moved to the Recycle Bin" : (r && r.err) || "Couldn't delete that clip");
    loadClips();
  }
  $("clDel").onclick = () => {
    if (!clipNow) return;
    const b = $("clDel");
    if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Sure? Click again"; setTimeout(() => { b.dataset.sure = ""; b.textContent = "Delete"; }, 3000); return; }
    b.dataset.sure = ""; b.textContent = "Delete"; deleteClip(clipNow);
  };
  // Back: from a clip that's open (the editor), back to your clips; from the clips list, back to where you were
  $("clBack").onclick = () => { if (!$("clPlay").hidden) { $("clClose").click(); try { $("tab-clips").scrollTo({ top: 0, behavior: "smooth" }); } catch {} return; } showTab(mainTab); };
  $("clRefresh").onclick = loadClips;
  $("clOpen").onclick = () => flKind === "clips" ? D.medalFolder() : D.filesOpen(flKind);
  $("clChoose").onclick = () => (flKind === "clips" ? D.clipsChoose() : D.filesChoose(flKind)).then(loadClips);
  document.querySelectorAll("#flMode button").forEach(b => b.onclick = () => { flKind = b.dataset.k; store.set("fl.kind", flKind); loadClips(); });
  const medalMsg = () => { $("medalKeyMsg").textContent = ""; };   // (the Siege live scoreboard key is gone)
  D.medalKey().then(r => { if (r) medalMsg(r); }).catch(() => {});
  /* ---------- Clips: Sothis's own recorder ---------- */
  let ckS = null;
  function ckRender(s) {
    if (s) ckS = s; s = ckS; if (!s) return;
    const c = s.cfg || {};
    $("ckOn").setAttribute("aria-checked", c.on !== false); $("ckMic").setAttribute("aria-checked", !!c.mic);
    if (document.activeElement !== $("ckKey")) $("ckKey").value = c.key || "F8";
    if (document.activeElement !== $("ckLen")) $("ckLen").value = String(c.len || 30);
    if (document.activeElement !== $("ckFps")) $("ckFps").value = String(c.fps || 60);
    if (document.activeElement !== $("ckQ")) $("ckQ").value = c.quality || "high";
    if (document.activeElement !== $("ckMon")) $("ckMon").value = String(c.monitor ?? "auto");
    const sv = c.sysVol ?? 100, mv = c.micVol ?? 100, vv = c.voiceVol ?? 100;
    if (!ckVolDrag.voice) { $("ckVoiceVol").value = vv; $("ckVoiceV").textContent = vv + "%"; }
    $("ckVoiceMute").setAttribute("aria-pressed", !!c.voiceMute); $("ckVoiceMute").textContent = c.voiceMute ? "Muted" : "Mute"; $("ckVoiceVol").disabled = !!c.voiceMute;
    if (!ckVolDrag.sys) { $("ckSysVol").value = sv; $("ckSysV").textContent = sv + "%"; }
    if (!ckVolDrag.mic) { $("ckMicVol").value = mv; $("ckMicV").textContent = mv + "%"; }
    $("ckSysMute").setAttribute("aria-pressed", !!c.sysMute); $("ckSysMute").textContent = c.sysMute ? "Muted" : "Mute";
    $("ckMicMute").setAttribute("aria-pressed", !!c.micMute); $("ckMicMute").textContent = c.micMute ? "Muted" : "Mute";
    $("ckSysVol").disabled = !!c.sysMute; $("ckMicVol").disabled = !!c.micMute;
    $("ckMicRow").hidden = !c.mic; $("ckNsRow").hidden = !c.mic;
    if (document.activeElement !== $("ckNs")) $("ckNs").value = c.noise || "strong";
    if (document.activeElement !== $("ckSync")) $("ckSync").value = String(c.audioOffset || 0);
    $("ckWin").setAttribute("aria-checked", c.window !== false);
    $("ckHide").setAttribute("aria-checked", c.hideSothis !== false);
    $("ckSetup").hidden = !!s.ready || s.phase === "setup";
    const keyTxt = c.key === "Mouse4" ? "your mouse back button" : c.key === "Mouse5" ? "your mouse forward button" : c.key || "F8";
    $("ckStatus").textContent = s.phase === "setup" ? `${s.msg || "Setting up the recorder…"}${s.progress ? " " + s.progress + "%" : ""}`
      : s.phase === "error" ? s.msg
      : !s.ready ? "Sothis needs to download its recorder once (about 85 MB, a free ffmpeg build). Click Set up the recorder."
      : s.recording ? `Recording now. Press ${keyTxt} to save the last ${c.len || 30} seconds.` + (s.keys ? "" : " (Key watcher not running: only the Clip it button works.)")
      : c.on === false ? "Recording is off." : `Ready. It starts recording when you open a game. Press ${keyTxt} to save a clip.`;
  }
  const ckSet = o => D.clipsSet(o).then(ckRender).catch(() => {});
  const ckVolDrag = { sys: false, mic: false, voice: false };
  for (const [k, id, lab] of [["sys", "ckSysVol", "ckSysV"], ["mic", "ckMicVol", "ckMicV"], ["voice", "ckVoiceVol", "ckVoiceV"]]) {
    let t = null;
    $(id).addEventListener("input", () => { ckVolDrag[k] = true; $(lab).textContent = $(id).value + "%"; clearTimeout(t); t = setTimeout(() => { ckSet({ [k + "Vol"]: +$(id).value }).then(() => { ckVolDrag[k] = false; }); }, 200); });
  }
  $("ckSysMute").onclick = () => ckSet({ sysMute: $("ckSysMute").getAttribute("aria-pressed") !== "true" });
  $("ckVoiceMute").onclick = () => ckSet({ voiceMute: $("ckVoiceMute").getAttribute("aria-pressed") !== "true" });
  $("ckMicMute").onclick = () => ckSet({ micMute: $("ckMicMute").getAttribute("aria-pressed") !== "true" });
  $("ckSync").onchange = () => ckSet({ audioOffset: +$("ckSync").value });
  $("ckNs").onchange = () => ckSet({ noise: $("ckNs").value });
  $("ckHide").onclick = () => ckSet({ hideSothis: $("ckHide").getAttribute("aria-checked") !== "true" });
  $("ckWin").onclick = () => ckSet({ window: $("ckWin").getAttribute("aria-checked") !== "true" });
  D.clipsState().then(ckRender).catch(() => {});
  D.onClipState(() => D.clipsState().then(ckRender).catch(() => {}));
  setInterval(() => { if (tab === "settings") D.clipsState().then(ckRender).catch(() => {}); }, 3000);
  $("ckOn").onclick = () => ckSet({ on: $("ckOn").getAttribute("aria-checked") !== "true" });
  $("ckMic").onclick = () => ckSet({ mic: $("ckMic").getAttribute("aria-checked") !== "true" });
  $("ckKey").onchange = () => ckSet({ key: $("ckKey").value });
  $("ckLen").onchange = () => ckSet({ len: +$("ckLen").value });
  $("ckFps").onchange = () => ckSet({ fps: +$("ckFps").value });
  $("ckQ").onchange = () => ckSet({ quality: $("ckQ").value });
  $("ckMon").onchange = () => ckSet({ monitor: $("ckMon").value });
  $("ckSetup").onclick = () => { $("ckSetup").hidden = true; D.clipsSetup().then(ckRender).catch(() => {}); };
  D.onClipSaved(v => { toast("Clip saved: " + v.name); try { if (tab === "clips") loadClips(); } catch {} });
  // clip sound: system sound (and your mic) kept for the last ~2 minutes in memory, handed over when a clip is saved
  // Sound is kept by sample position on the audio clock (not by when a chunk happens to arrive), so it lines up with the video.
  // Game sound and your mic are kept apart, so a clip can turn either up, down or off, and clean up only the mic.
  const CA = { ctx: null, node: null, streams: [], ringS: null, ringM: null, frames: 0, hi: -1, on: false, mic: false, hasMic: false, wall0: null };
  const CA_RATE = 48000, CA_SECS = 130;
  function caOff() { CA.on = false; try { CA.streams.forEach(s => s.getTracks().forEach(t => t.stop())); } catch {} CA.streams = []; try { CA.ctx && CA.ctx.close(); } catch {} CA.ctx = null; CA.node = null; CA.ringS = CA.ringM = null; CA.hi = -1; CA.hasMic = false; CA.wall0 = null; }
  // wall-clock time (ms) of audio-clock time 0, from the browser's own pairing of the two clocks
  function caSync() {
    const ctx = CA.ctx; if (!ctx) return;
    try { const t = ctx.getOutputTimestamp(); if (t && t.performanceTime > 0 && t.contextTime > 0) { const lat = ((ctx.baseLatency || 0) + (ctx.outputLatency || 0)) * 1000, w = performance.timeOrigin + t.performanceTime - t.contextTime * 1000 - lat; CA.wall0 = CA.wall0 == null ? w : CA.wall0 * 0.9 + w * 0.1; } } catch {}
  }
  // to 16-bit with a soft knee above 80%: loud moments round off smoothly instead of being chopped flat (that chopping was the harsh, crackly clip sound)
  const soft = v => { const a = Math.abs(v); if (a <= 0.8) return v; const y = 0.8 + 0.2 * Math.tanh((a - 0.8) / 0.2); return v < 0 ? -y : y; };
  const s16 = v => Math.round(soft(v) * 32767);
  async function caOn(o) {
    caOff(); CA.on = true; CA.mic = !!o.mic;
    try {
      const ds = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      ds.getVideoTracks().forEach(t => t.stop());
      if (!CA.on) { ds.getTracks().forEach(t => t.stop()); return; }
      const ctx = new AudioContext({ sampleRate: CA_RATE, latencyHint: "interactive" }); CA.ctx = ctx; CA.streams = [ds];
      const code = 'class R extends AudioWorkletProcessor{process(i){const g=i[0],m=i[1];const n=(g&&g[0]&&g[0].length)||(m&&m[0]&&m[0].length)||0;if(n){const z=new Float32Array(n);this.port.postMessage([currentFrame,g&&g[0]?g[0].slice(0):z,g&&g[0]?(g[1]||g[0]).slice(0):z,m&&m[0]?m[0].slice(0):null]);}return true}}registerProcessor("sothis-rec2",R)';
      await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: "application/javascript" })));
      const node = new AudioWorkletNode(ctx, "sothis-rec2", { numberOfInputs: 2, numberOfOutputs: 1, channelCount: 2, channelCountMode: "explicit" });
      if (ds.getAudioTracks().length) ctx.createMediaStreamSource(ds).connect(node, 0, 0);
      if (o.mic) {
        try {
          // the browser's own light noise filter stays off: Sothis cleans the mic up itself when it saves a clip
          const ms = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true } });
          CA.streams.push(ms); ctx.createMediaStreamSource(ms).connect(node, 0, 1); CA.hasMic = true;
        } catch {}
      }
      const sink = ctx.createGain(); sink.gain.value = 0; node.connect(sink); sink.connect(ctx.destination);
      CA.frames = CA_RATE * CA_SECS; CA.ringS = new Int16Array(CA.frames * 2); CA.ringM = CA.hasMic ? new Int16Array(CA.frames) : null; CA.hi = -1;
      node.port.onmessage = e => {
        const [f0, L, Rr, M] = e.data, rs = CA.ringS, rm = CA.ringM; if (!rs) return;
        // each sample goes to its own place on the audio clock; anything missed stays silent instead of shifting the rest
        if (CA.hi >= 0 && f0 > CA.hi + 1) for (let f = CA.hi + 1; f < f0 && f < CA.hi + 1 + CA.frames; f++) { const p = f % CA.frames; rs[p * 2] = rs[p * 2 + 1] = 0; if (rm) rm[p] = 0; }
        for (let i = 0; i < L.length; i++) {
          const p = (f0 + i) % CA.frames;
          rs[p * 2] = s16(L[i]); rs[p * 2 + 1] = s16(Rr[i]);
          if (rm) rm[p] = M ? s16(M[i]) : 0;
        }
        CA.hi = Math.max(CA.hi, f0 + L.length - 1);
      };
      CA.node = node;
      caSync(); clearInterval(caOn.t); caOn.t = setInterval(caSync, 1000);
    } catch (e) { CA.on = false; console.warn("clip sound unavailable", e); }
  }
  D.onClipAudio(o => {
    if (!o || !o.on) { clearInterval(caOn.t); caOff(); return; }
    if (!(CA.on && CA.ctx && CA.mic === !!o.mic)) caOn(o);
  });
  D.onClipAudioReq(({ id, from, dur }) => {
    const rs = CA.ringS, rm = CA.ringM;
    caSync();
    if (!rs || CA.hi < 0 || CA.wall0 == null) { D.clipAudioRes({ id, pcm: null }); return; }
    const frames = Math.round(dur * CA_RATE), out = new Int16Array(frames * 2), mic = rm ? new Int16Array(frames) : null;
    const f0 = Math.round((from - CA.wall0) / 1000 * CA_RATE), lo = CA.hi - CA.frames + 1;
    for (let f = 0; f < frames; f++) {
      const a = f0 + f; if (a < lo || a > CA.hi || a < 0) continue;
      const p = a % CA.frames; out[f * 2] = rs[p * 2]; out[f * 2 + 1] = rs[p * 2 + 1]; if (mic) mic[f] = rm[p];
    }
    D.clipAudioRes({ id, rate: CA_RATE, ch: 2, pcm: out.buffer, mic: mic ? mic.buffer : null });
  });

