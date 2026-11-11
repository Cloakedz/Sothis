  /* ---------- Discord (discord.com inside the app) ---------- */
  let dc = null;
  function ensureDiscord() {
    if (dc) return;
    dc = document.createElement("webview");
    dc.setAttribute("partition", "persist:discord");
    dc.setAttribute("src", "https://discord.com/app");
    $("dcWrap").append(dc);
    dc.addEventListener("did-start-loading", () => $("dcLoad").classList.add("on"));
    dc.addEventListener("did-stop-loading", () => $("dcLoad").classList.remove("on"));
  }


  /* ---------- Fullscreen ---------- */
  let isFull = false;
  D.onFull(on => { isFull = on; document.body.classList.toggle("is-full", on); });
  document.addEventListener("keydown", e => {
    if (e.key === "F11") { e.preventDefault(); D.fullscreen(); }
    else if (e.key === "Escape" && isFull && tab !== "settings") D.fullscreen(false);
  });


  /* ---------- YouTube Music (music.youtube.com inside the app) ---------- */
  let yt = null;
  function ensureYTM() {
    if (yt) return;
    yt = document.createElement("webview");
    yt.setAttribute("partition", "persist:ytm");
    yt.setAttribute("useragent", D.firefoxUA || "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:148.0) Gecko/20100101 Firefox/148.0");
    yt.setAttribute("allowpopups", "");
    yt.setAttribute("webpreferences", "backgroundThrottling=no");
    yt.setAttribute("src", "https://music.youtube.com/");
    $("ytWrap").append(yt);
    yt.addEventListener("did-start-loading", () => $("ytLoad").classList.add("on"));
    yt.addEventListener("did-stop-loading", () => $("ytLoad").classList.remove("on"));
    watchNav(yt);
  }

  /* Regular YouTube, in the same tab (shares the YouTube Music sign-in) */
  let ytv = null, ytView = ["yt", "spot"].includes(store.get("yt.view")) ? store.get("yt.view") : "music";
  // Songspot: the song guessing game, in its own webview (its own storage, so your streak is kept)
  let spotv = null;
  function ensureSpot() {
    if (spotv) return;
    spotv = document.createElement("webview");
    spotv.setAttribute("partition", "persist:songspot");
    spotv.setAttribute("webpreferences", "backgroundThrottling=no");
    spotv.setAttribute("src", "https://songspot.net/");
    $("spotWrap").append(spotv);
    spotv.addEventListener("did-start-loading", () => { if (ytView === "spot") $("spotLoad").classList.add("on"); });
    spotv.addEventListener("did-stop-loading", () => $("spotLoad").classList.remove("on"));
    spotv.addEventListener("did-navigate-in-page", () => ytNavState());
    spotv.addEventListener("did-navigate", () => ytNavState());
  }
  function ensureYouTube() {
    if (ytv) return;
    ytv = document.createElement("webview");
    ytv.setAttribute("partition", "persist:ytm");
    ytv.setAttribute("useragent", D.firefoxUA || "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:148.0) Gecko/20100101 Firefox/148.0");
    ytv.setAttribute("allowpopups", "");
    ytv.setAttribute("webpreferences", "backgroundThrottling=no");
    ytv.setAttribute("src", "https://www.youtube.com/");
    $("ytWrap").append(ytv);
    ytv.addEventListener("did-start-loading", () => { if (ytView === "yt") $("ytLoad").classList.add("on"); });
    ytv.addEventListener("did-stop-loading", () => $("ytLoad").classList.remove("on"));
    watchNav(ytv);
  }
  /* ---------- Features: what's switched on. Off features are hidden everywhere; your own copy has a list in Settings ---------- */
  const FEATS = [
    ["Music", [
      ["music", "Music tab", "YouTube Music, Spotify or Apple Music inside Sothis", ["#tabbtn-ytm"]],
      ["spotifyApple", "Spotify and Apple Music", "The other two sign-in boxes in Music", ['.ms-box[data-svc="spotify"]', '.ms-box[data-svc="apple"]']],
      ["lyrics", "Lyrics", "Synced lyrics and the pop-out window", ["#lyBtn", "#lyPanel"]],
      ["visualizer", "Visualizer", "The ring of bars around the crest", [".viz", ".viz-glow", ".setting:has(#setViz)"]]]],
    ["Games", [
      ["games", "Games tab", "Your PC games and game news", ["#tabbtn-games"]],
      ["retro", "Retro", "Old console games inside Sothis", ['#gmMode [data-m="retro"]']],
      ["releases", "Releases", "Upcoming anime and games", ['#gmMode [data-m="rel"]']],
      ["mods", "Mods", "Your Mod Organizer setups", ['#gmMode [data-m="mods"]']],
      ["stats", "Stats tab", "Overwatch, CS2 and Siege ranks", ["#tabbtn-stats"]],
      ["switch", "Switch tab", "The Switch emulator page", ["#tabbtn-switch"]]]],
    ["Apps", [
      ["claude", "Claude button", "Claude inside Sothis", ["#tabbtn-claude"]],
      ["opera", "Browser button", "The Blackwall button in the corner", [".op-fab"]],
      ["discord", "Discord call", "The call card, Discord button and voice overlay", ["#dcBtn", "#hmDc"]],
      ["dcStatus", "Discord status", "Your song or game in your Discord status", [".setting:has(#setDcPres)", ".setting:has(#setDcIdle)", ".setting:has(#setDcName)"]],
      ["gameDetails", "Game details in status", "Cyberpunk and Skyrim details in your Discord status", []],
      ["crunchyroll", "Crunchyroll status", "What you watch on Crunchyroll in your status", [".setting:has(#setCrExt)"]],
      ["sound", "Sound mixer", "The sound button and per-app volume", ["#sndBtn"]]]],
    ["Clips and files", [
      ["clips", "Clips", "Records your games so you can save the last moments", ["#hmClip", ".setting:has(#ckOn)"]],
      ["files", "Files page", "Clips, ROMs, MP3, MP4 and photos", ["#hmClipDir", "#hmFiles"]],
      ["screenshots", "Screenshots", "Every game screenshot, by game", ['#flMode [data-k="shots"]']]]],
    ["Home and extras", [
      ["phone", "Phone remote", "Control Sothis from your phone", ["#phGroup"]],
      ["battery", "Mouse battery", "The battery badge and alerts", ["#battBadge", "#mBatt"]],
      ["weather", "Weather", "The weather chip", ["#wxBadge"]],
      ["minecraft", "Minecraft server", "Your server's player count", ["#mcBadge"]],
      ["week", "Your week", "The weekly recap", ["#hmWeek"]],
      ["daily", "Daily start screen", "Weather, releases and yesterday each morning", [".ds", ".setting:has(#setDaily)"]],
      ["notes", "Notes", "The notes box on Home", ["#hmNotes"]],
      ["patchNotes", "Patch notes", "What's new when you hover the bell", [".pn-pop"]]]]
  ];
  let ftState = D.features || { owner: false, on: {}, list: {} };
  function ftApply() {
    let css = "";
    for (const [, items] of FEATS) for (const [id, , , sel] of items) if (ftState.on && ftState.on[id] === false && sel.length) css += sel.join(", ") + " { display: none !important; }\n";
    let st = document.getElementById("ftStyle"); if (!st) { st = document.createElement("style"); st.id = "ftStyle"; document.head.append(st); }
    st.textContent = css;
    // a switched-off tab you're on: back to Home
    const tabFeat = { ytm: "music", games: "games", stats: "stats", switch: "switch", claude: "claude" };
    try { if (tabFeat[tab] && ftState.on[tabFeat[tab]] === false) showTab("home"); } catch {}
  }
  function ftRender() {
    $("ftGroup").hidden = !ftState.owner;
    if (!ftState.owner) return;
    const list = $("ftList"); list.replaceChildren();
    for (const [sec, items] of FEATS) {
      list.append(mk("div", "ft-sec", sec));
      for (const [id, name, desc] of items) {
        const row = mk("div", "ft-row"), tx = mk("div", "txt"); tx.append(mk("b", "", name), mk("span", "", desc));
        const v = (ftState.list && ftState.list[id]) || { private: true, github: true };
        const sw = which => { const b = mk("button", "switch"); b.type = "button"; b.setAttribute("role", "switch"); b.setAttribute("aria-checked", String(!!v[which])); b.setAttribute("aria-label", name + (which === "private" ? " on my copy" : " on the GitHub copy"));
          b.onclick = async () => { row.classList.add("busy"); let r = null; try { r = await D.featuresSet(id, which, !v[which]); } catch {} row.classList.remove("busy");
            if (r && r.state) { ftState = r.state; ftApply(); ftRender(); }
            if (r && !r.ok && r.err) toast(r.err); else if (which === "github") toast(name + (v[which] ? " removed from" : " added to") + " the GitHub copy"); };
          return b; };
        row.append(tx, sw("private"), sw("github"));
        list.append(row);
      }
    }
    $("ftTokDesc").lastChild && 0;
    $("ftTok").placeholder = ftState.token ? "Saved (paste a new one to replace)" : "github_pat_…";
  }
  $("ftTokSave").onclick = async () => {
    const t = $("ftTok").value.trim(), btn = $("ftTokSave"); btn.disabled = true; btn.textContent = "Checking…";
    let r = null; try { r = await D.featuresToken(t); } catch {}
    btn.disabled = false; btn.textContent = "Save";
    if (r && r.ok !== false) $("ftTok").value = "";
    if (r) { ftState = r; ftRender(); }
    toast(r && r.msg ? r.msg : "Couldn't save the token");
  };
  D.onFeatures(d => { ftState = d; ftApply(); ftRender(); });
  ftApply(); ftRender();

  /* ---------- Lyrics: synced lyrics for whatever's playing, in the Music tab or popped out into their own window ---------- */
  let lyOpen = false, lyPopped = false, lyKey = "", lyData = null, lyLoading = false, lyCur = -2, lyStateAt = 0;

  // YouTube Music's own lyrics for the song playing, asked for from inside the YouTube Music page
  const YTM_LYRICS = `(async () => {
    const cfg = (window.ytcfg && (ytcfg.data_ || {})) || {};
    const key = cfg.INNERTUBE_API_KEY, web = cfg.INNERTUBE_CONTEXT;
    const mp = document.getElementById("movie_player");
    let vid = ""; try { vid = mp.getVideoData().video_id; } catch (e) {}
    if (!key || !web || !vid) return null;
    const post = async (ep, body, ctx) => { const r = await fetch("/youtubei/v1/" + ep + "?prettyPrint=false&key=" + key, { method: "POST", credentials: "omit", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({ context: ctx || web }, body)) }); return r.ok ? r.json() : null; };
    const find = (o, k, out) => { out = out || []; if (o && typeof o === "object") { if (k in o) out.push(o[k]); for (const v of Object.values(o)) find(v, k, out); } return out; };
    const nx = await post("next", { videoId: vid, isAudioOnly: true });
    const bid = find(nx, "browseId").find(b => typeof b === "string" && b.startsWith("MPLY"));
    if (!bid) return { none: true, vid };
    // the phone app's request returns timed lines when YouTube Music has them
    let timed = [];
    try {
      const an = await post("browse", { browseId: bid }, { client: { clientName: "ANDROID_MUSIC", clientVersion: "7.21.50", androidSdkVersion: 30, hl: (web.client && web.client.hl) || "en", gl: (web.client && web.client.gl) || "US" } });
      const d = find(an, "timedLyricsData")[0] || [];
      timed = d.map(x => [((x.cueRange && +x.cueRange.startTimeMilliseconds) || 0) / 1000, String(x.lyricLine || "").trim()]);
    } catch (e) {}
    let plain = "", src = "";
    try {
      const wb = await post("browse", { browseId: bid });
      const sh = find(wb, "musicDescriptionShelfRenderer")[0];
      if (sh) { plain = ((sh.description && sh.description.runs) || []).map(r => r.text).join(""); src = ((sh.footer && sh.footer.runs) || []).map(r => r.text).join(""); }
    } catch (e) {}
    return { vid, timed, plain: plain.trim(), src: src.trim() };
  })()`;
  async function ytmLyrics() {
    const r = await yt.executeJavaScript(YTM_LYRICS);
    if (!r || r.none) return null;
    const synced = (r.timed || []).filter(x => Array.isArray(x) && isFinite(x[0]));
    if (!synced.length && !r.plain) return null;
    return { synced, plain: r.plain || synced.map(x => x[1]).join("\n"), instrumental: false, source: "YouTube Music" + (r.src ? " · " + r.src.replace(/^source:\s*/i, "") : "") };
  }
  async function lyFetch() {
    const y = ytState && ytState.has ? ytState : null;
    const key = y ? y.title + "\u0001" + y.artist : "";
    if (key === lyKey) return;
    lyKey = key; lyData = null; lyCur = -2;
    if (!y) { lyRender(); return; }
    lyLoading = true; lyRender();
    let r = null;
    // your own copy, on YouTube Music: the lyrics YouTube Music itself shows (timed when it has them), else LRCLIB
    try { if (ftState && ftState.owner && musicSvc === "ytm" && yt) r = await ytmLyrics(); } catch {}
    if (lyKey !== key) return;
    if (!r) { try { r = await D.lyricsGet({ title: y.title, artist: y.artist, dur: y.dur }); } catch {} }
    if (lyKey !== key) return;
    lyData = r; lyLoading = false; lyRender();
  }
  function lyRender() {
    const y = ytState && ytState.has ? ytState : null, box = $("lyBody");
    $("lyT").textContent = y ? y.title : "Lyrics"; $("lyA").textContent = y ? y.artist : "";
    box.className = "lyp-b"; box.replaceChildren(); lyCur = -2;
    const say = t => box.append(mk("p", "lyp-msg", t));
    if (!y) return say("Play a song to see its lyrics.");
    if (lyLoading) return say("Finding lyrics…");
    if (!lyData) return say("No lyrics found for this song.");
    if (lyData.instrumental) return say("Instrumental ♪");
    if (!lyData.synced.length) { box.className = "lyp-b plain"; for (const l of String(lyData.plain).split(/\n/)) box.append(mk("p", "", l || " ")); return; }
    for (const [t, l] of lyData.synced) { const p = mk("p", "lyp-seek", l || "♪"); p.title = "Play from here"; p.onclick = () => lySeek(t); box.append(p); }
  }
  // click a lyric line to jump the song to it (plays it too if it was paused)
  function lySeek(t) {
    const y = ytState && ytState.has ? ytState : null; if (!y || !y.dur || !isFinite(t)) return;
    ytCmd("seek", Math.max(0, Math.min(1, t / y.dur)));
    y.pos = t; lyStateAt = Date.now(); lyCur = -2;
    if (!y.playing) setTimeout(() => ytCmd("playpause"), 200);
  }
  try { if (D.onLyricsSeek) D.onLyricsSeek(t => lySeek(+t)); } catch {}
  function lyPos() { const y = ytState; if (!y) return 0; return (y.pos || 0) + (y.playing ? (Date.now() - lyStateAt) / 1000 : 0) + 0.25; }
  function lyTick() {
    requestAnimationFrame(lyTick);
    if (!lyOpen || !lyData || !lyData.synced.length) return;
    const pos = lyPos(), L = lyData.synced; let i = -1;
    for (let n = 0; n < L.length; n++) { if (L[n][0] <= pos) i = n; else break; }
    if (i === lyCur) return; lyCur = i;
    const ps = $("lyBody").children;
    for (let n = 0; n < ps.length; n++) { ps[n].classList.toggle("on", n === i); ps[n].classList.toggle("past", n < i); }
    if (i >= 0 && ps[i]) { const b = $("lyBody"); b.scrollTop = ps[i].getBoundingClientRect().top - b.getBoundingClientRect().top + b.scrollTop - b.clientHeight * 0.38; }
  }
  requestAnimationFrame(lyTick);
  function lyShow(on) { lyOpen = on; $("lyPanel").hidden = !on; $("lyBtn").setAttribute("aria-pressed", String(on || lyPopped)); if (on) { lyFetch(); lyRender(); } }
  $("lyBtn").onclick = () => { if (lyPopped) { D.lyricsPopout(true); return; } lyShow(!lyOpen); };
  $("lyX").onclick = () => lyShow(false);
  $("lyPop").onclick = () => { lyShow(false); D.lyricsPopout(true); };
  D.onLyricsPopped(v => { lyPopped = !!v; $("lyBtn").setAttribute("aria-pressed", String(lyOpen || lyPopped)); if (!v && tab === "ytm") lyShow(true); });
  // keep the lyrics (and the pop-out) in step with the song
  setInterval(() => {
    if (!lyOpen && !lyPopped) return;
    lyFetch();
    if (lyPopped) { const y = ytState && ytState.has ? ytState : null; D.lyricsPush({ title: y ? y.title : "", artist: y ? y.artist : "", art: y ? y.art : "", pos: y ? lyPos() - 0.25 : 0, playing: !!(y && y.playing), lyrics: lyData, loading: lyLoading }); }
  }, 500);

  /* ---------- Music service: pick YouTube Music, Spotify or Apple Music; only the one you pick shows ---------- */
  var MS = { ytm: { name: "YouTube Music" }, spotify: { name: "Spotify", url: "https://open.spotify.com/", part: "persist:spotify" }, apple: { name: "Apple Music", url: "https://music.apple.com/", part: "persist:applemusic" } };
  var musicSvc = MS[store.get("music.svc")] ? store.get("music.svc") : "", msv = null, msvFor = "", msDrm = { engine: true, ok: true };
  try { D.musicDrm().then(d => { if (d) msDrm = d; msPaintPick(); }).catch(() => {}); } catch {}
  function msName() { return (MS[musicSvc] || MS.ytm).name; }
  function ensureMs() {
    const m = MS[musicSvc]; if (!m || !m.url) return;
    if (msv && msvFor === musicSvc) return;
    if (msv) { try { msv.remove(); } catch {} msv = null; }
    msv = document.createElement("webview");
    msv.setAttribute("partition", m.part);
    msv.setAttribute("allowpopups", "");
    msv.setAttribute("webpreferences", "backgroundThrottling=no");
    msv.setAttribute("src", m.url);
    msvFor = musicSvc;
    $("msWrap").append(msv);
    msv.addEventListener("did-start-loading", () => $("msLoad").classList.add("on"));
    msv.addEventListener("did-stop-loading", () => { $("msLoad").classList.remove("on"); ytNavState(); });
    msv.addEventListener("did-navigate-in-page", () => ytNavState());
  }
  function msPaintPick() {
    document.querySelectorAll(".ms-box").forEach(b => {
      b.classList.toggle("cur", b.dataset.svc === musicSvc);
      b.classList.toggle("na", b.dataset.svc !== "ytm" && msDrm && msDrm.engine === false);
    });
    $("msNote").textContent = msDrm && msDrm.engine === false ? "Spotify and Apple Music need the newest Sothis installer (they play protected music). Download it from the GitHub page and run it once." : "";
    $("msPickClose").hidden = !musicSvc;
    $("msChipImg").src = "logos/svc-" + (musicSvc || "ytm") + ".png";
  }
  function msOpenPick(on) { $("msPick").hidden = !on; msPaintPick(); }
  function msApply() {
    const other = musicSvc && musicSvc !== "ytm";
    $("tab-ytm").classList.toggle("svc", !!other);
    $("tabbtn-ytm").setAttribute("aria-label", msName());
    if (!musicSvc) { msOpenPick(true); return; }
    msOpenPick(false);
    if (other) {
      ensureMs();
      // only one service plays: pause YouTube Music if it was going
      if (yt) { try { yt.executeJavaScript("document.querySelectorAll('video,audio').forEach(m => m.pause())").catch(() => {}); } catch {} }
    } else {
      if (msv) { try { msv.remove(); } catch {} msv = null; msvFor = ""; }
      ensureYTM(); showYtView(ytView);
    }
    ytNavState(); renderYnp();
  }
  document.querySelectorAll(".ms-box").forEach(b => b.onclick = () => {
    const s = b.dataset.svc;
    if (s !== "ytm" && msDrm && msDrm.engine === false) { toast("Install the newest Sothis to use " + MS[s].name); return; }
    musicSvc = s; store.set("music.svc", s); msApply();
    if (s !== "ytm") toast("Sign in to " + MS[s].name + " here. Sothis remembers it");
  });
  $("msChip").onclick = () => msOpenPick(true);
  $("msPickClose").onclick = () => msOpenPick(false);
  msPaintPick();
  function showYtView(v) {
    const was = ytView;
    ytView = v === "yt" || v === "spot" ? v : "music";
    store.set("yt.view", ytView);
    $("tab-ytm").classList.toggle("spot", ytView === "spot");
    if (ytView === "spot") {
      ensureSpot();
      // the game needs to be heard: pause your music while you play
      if (was !== "spot" && ytState && ytState.playing) { ytCmd("playpause"); toast("Music paused for Songspot"); }
      setTimeout(() => { try { spotv.focus(); } catch {} }, 60);
    } else if (spotv && was === "spot") { try { spotv.setAudioMuted(true); setTimeout(() => { try { spotv.setAudioMuted(false); } catch {} }, 50); spotv.executeJavaScript("document.querySelectorAll('audio,video').forEach(m=>m.pause())").catch(() => {}); } catch {} }
    ensureYTM();
    yt.classList.remove("yv-off");
    $("ytsView").hidden = ytView !== "yt" || false;
    $("ytlView").hidden = ytView !== "music";
    $("tab-ytm").classList.toggle("searching", ytView === "yt");
    $("tab-ytm").classList.toggle("site", ytSite);
    $("ytSite").setAttribute("aria-pressed", ytSite);
    if (ytView === "music" && !ytSite && !ytlDetail && !$("ytlList").children.length) ytlLoad();
    if (ytView === "yt" && !ytSite) setTimeout(() => $("ytsQ").focus(), 30);
    renderYnp();
    document.querySelectorAll("#ytSw button").forEach(b => b.setAttribute("aria-checked", b.dataset.yv === ytView));
    ytNavState();
  }
  document.querySelectorAll("#ytSw button").forEach(b => b.addEventListener("click", () => showYtView(b.dataset.yv)));
  const ytActive = () => musicSvc && musicSvc !== "ytm" ? msv : ytView === "spot" ? spotv : ytSite ? yt : null;
  function ytNavState() {
    const w = ytActive();
    let back = false, fwd = false;
    if (w) { try { back = w.canGoBack(); fwd = w.canGoForward(); } catch {} }
    else if (ytView === "music") { back = !!ytlDetail; fwd = !ytlDetail && !!ytlFwd; }
    $("ytBack").disabled = !back; $("ytFwd").disabled = !fwd;
  }
  $("ytBack").onclick = () => { const w = ytActive(); if (w) { try { if (w.canGoBack()) w.goBack(); } catch {} } else if (ytView === "music") ytlBack(); };
  $("ytFwd").onclick = () => { const w = ytActive(); if (w) { try { if (w.canGoForward()) w.goForward(); } catch {} } else if (ytView === "music" && ytlFwd) { const f = ytlFwd; ytlFwd = null; ytlOpen(f); } };
  function watchNav(w) { ["did-navigate", "did-navigate-in-page", "dom-ready"].forEach(ev => w.addEventListener(ev, ytNavState)); }

  /* ---------- Home ---------- */
  function nowInfo() {
    if (ytState && ytState.has) return { src: msName(), title: ytState.title, artist: ytState.artist, art: ytState.art, pos: ytState.pos, dur: ytState.dur, playing: ytState.playing };
    return null;
  }
  function renderHome() {
    if (tab !== "home" && !document.body.classList.contains("wd-has-side")) return;   // the wide layout's side panel shows what's playing on every tab
    const d = new Date();
    const tt = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if ($("hmTime").dataset.t !== tt) {
      $("hmTime").dataset.t = tt;
      const mm = tt.match(/^(.*?)\s*([AaPp]\.?\s?[Mm]\.?)$/);
      $("hmTime").replaceChildren(mk("span", "t", mm ? mm[1] : tt));
      if (mm) $("hmTime").append(mk("span", "ap", mm[2].replace(/[.\s]/g, "").toUpperCase()));
    }
    const h = d.getHours();
    const greet = h < 5 ? "Up late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
    $("hmDate").textContent = greet + " · " + d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });

    // now playing
    const n = nowInfo();
    $("hmSrc").textContent = n ? (n.playing ? "Now playing" : "Paused") + " · " + n.src : "Now playing";
    $("hmTitle").textContent = n ? n.title || "Unknown song" : "Nothing playing";
    $("hmArtist").textContent = n ? n.artist || "" : "Open " + msName() + " to start";
    const art = n && n.art;
    if (art) { if ($("hmArt").getAttribute("src") !== art) $("hmArt").src = art; } else $("hmArt").removeAttribute("src");
    $("hmFill").style.width = (n && n.dur ? Math.min(100, n.pos / n.dur * 100) : 0) + "%";
    { const t = x => { x = Math.max(0, Math.floor(+x || 0)); const h = Math.floor(x / 3600), m = Math.floor(x % 3600 / 60), sec = String(x % 60).padStart(2, "0"); return h ? h + ":" + String(m).padStart(2, "0") + ":" + sec : m + ":" + sec; };
      $("hmCur").textContent = t(n && n.dur ? Math.min(n.pos, n.dur) : 0); $("hmDur").textContent = n && n.dur ? t(n.dur) : "0:00"; }
    $("hmPlayIcon").innerHTML = n && n.playing ? PAUSE : PLAY;
    $("hmPlay").setAttribute("aria-label", n && n.playing ? "Pause" : "Play");
    ["hmPrev", "hmPlay", "hmNext"].forEach(id => $(id).disabled = !n);

  }
  setInterval(renderHome, 1000);

  /* ---------- Wide layout: nav rail, the page, and a side panel (Settings → Layout) ---------- */
  var wdPref = false, wdTab = "", wdLyAuto = false;
  const wdMarks = {};
  function wdPut(id, slot) {
    const el = $(id); if (!el) return;
    if (!wdMarks[id]) { const m = document.createElement("i"); m.hidden = true; m.className = "wd-mark"; el.before(m); wdMarks[id] = m; }
    if (slot) { if (el.parentNode !== slot) slot.append(el); }
    else if (el.previousSibling !== wdMarks[id]) wdMarks[id].after(el);
  }
  function wdApply() {
    const b = document.body, W = window.innerWidth;
    const on = wdPref && W >= 900 && !b.classList.contains("is-mini") && !b.classList.contains("is-compact");
    b.classList.toggle("wide", on); b.classList.remove("wide-labels");   // icons only in the rail
    const side = on && ["home", "ytm", "games", "stats"].includes(tab);
    b.classList.toggle("wd-has-side", side); $("wdSide").hidden = !side;
    // what's playing on top, your Discord call under it
    wdPut("hmNow", side ? $("wdNow") : null);
    ["hmDcEmpty", "hmDc", "dcPins"].forEach(id => wdPut(id, side ? $("wdDc") : null));
    // Music: the lyrics fill the panel
    const ly = side && tab === "ytm";
    b.classList.toggle("wd-ly", ly);
    wdPut("lyPanel", ly ? $("wdExtra") : null);
    try {
      if (ly && wdTab !== "ytm" && !lyOpen && !lyPopped) { wdLyAuto = true; lyShow(true); }
      if (!ly && wdLyAuto) { wdLyAuto = false; if (lyOpen) lyShow(false); }
    } catch {}
    // Stats: the friends leaderboard
    const fr = side && tab === "stats";
    wdPut("frBoard", fr ? $("wdExtra") : null);
    try { if (fr && wdTab !== "stats") frBoard(); } catch {}
    // Home and Games: your newest clip
    const clip = side && (tab === "home" || tab === "games");
    if (!clip) $("wdClip").hidden = true; else if (wdTab !== tab) wdClipFill();
    wdTab = side ? tab : "";
    try { tabPill(); } catch {}
  }
  let wdClipNow = null;
  async function wdClipFill() {
    let r = null; try { r = await D.clipsList(); } catch {}
    const items = (r && r.items) || []; const c = items.slice().sort((a, b) => (b.at || 0) - (a.at || 0))[0];
    wdClipNow = c || null; $("wdClip").hidden = !c || !document.body.classList.contains("wd-has-side");
    if (!c) return;
    const v = $("wdClipV"); if (v.dataset.u !== c.url) { v.dataset.u = c.url; v.src = c.url + "#t=1"; }
    $("wdClipT").textContent = c.name; $("wdClipS").textContent = [c.game, ago(c.at)].filter(Boolean).join(" · ");
  }
  $("wdClip").onclick = () => { const c = wdClipNow; if (!c) return; showTab("clips"); setTimeout(() => { try { playClip(c); } catch {} }, 250); };
  // tab names, shown next to the icons when the window is wide enough
  [["home", "Home"], ["ytm", "Music"], ["games", "Games"], ["stats", "Stats"], ["switch", "Switch"], ["web", "Browser"]].forEach(([k, l]) => { const t = $("tabbtn-" + k); if (t && !t.querySelector(".wd-l")) t.append(mk("span", "wd-l", l)); });
  $("setWide").onclick = async () => {
    wdPref = !wdPref; $("setWide").setAttribute("aria-checked", wdPref);
    try { wdPref = await D.wideLayout(wdPref); } catch {}
    $("setWide").setAttribute("aria-checked", wdPref);
    setTimeout(wdApply, 60); setTimeout(wdApply, 400);
  };
  window.addEventListener("resize", () => { try { wdApply(); } catch {} });
  $("hmPlay").onclick = () => M.mPlay.onclick();
  $("hmPrev").onclick = () => M.mPrev.onclick();
  $("hmNext").onclick = () => M.mNext.onclick();
  $("hmArt").onclick = () => showTab("ytm");
  $("hmBar").addEventListener("click", e => {
    const b = $("hmBar").getBoundingClientRect(), f = (e.clientX - b.left) / b.width;
    ytCmd("seek", f);
  });

