  /* ---------- YouTube Music: add any YouTube video to one of your playlists ---------- */
  // Runs YouTube Music's own requests inside its (signed-in) page, so it works with your real playlists.
  function ytApi(path, body) {
    if (!yt) return Promise.reject(new Error("YouTube Music isn't loaded yet."));
    const js = `(async () => {
      const cfg = window.ytcfg;
      if (!cfg || !cfg.get) return { error: "notready" };
      const sap = (document.cookie.match(/(?:^|; )SAPISID=([^;]+)/) || document.cookie.match(/(?:^|; )__Secure-3PAPISID=([^;]+)/) || [])[1];
      if (!sap) return { error: "signedout" };
      const ts = Math.floor(Date.now() / 1000);
      const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(ts + " " + sap + " https://music.youtube.com"));
      const hash = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
      const r = await fetch("/youtubei/v1/" + ${JSON.stringify(path)} + "?prettyPrint=false", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", "Authorization": "SAPISIDHASH " + ts + "_" + hash,
          "X-Goog-AuthUser": String(cfg.get("SESSION_INDEX") || 0), "X-Origin": "https://music.youtube.com",
          "X-Youtube-Client-Name": String(cfg.get("INNERTUBE_CONTEXT_CLIENT_NAME") || 67), "X-Youtube-Client-Version": String(cfg.get("INNERTUBE_CLIENT_VERSION") || "") },
        body: JSON.stringify(Object.assign({ context: cfg.get("INNERTUBE_CONTEXT") }, ${JSON.stringify(body)}))
      });
      let json = null; try { json = await r.json(); } catch (e) {}
      return { status: r.status, json };
    })()`;
    return yt.executeJavaScript(js).then(r => {
      if (r && r.error === "signedout") { showSignIn(); throw new Error("Sign in to YouTube Music to see your music."); }
      if (r && r.error === "notready") throw new Error("YouTube Music is still loading. Try again in a moment.");
      if (!r || r.status >= 400) throw new Error("YouTube Music refused that (" + (r ? r.status : "no answer") + ").");
      return r.json || {};
    });
  }
  function videoIdFrom(text) {
    const t = String(text || "").trim();
    if (/^[\w-]{11}$/.test(t)) return t;
    try {
      const u = new URL(/^https?:/i.test(t) ? t : "https://" + t);
      const host = u.hostname.replace(/^(www|m|music)\./, "");
      if (host === "youtu.be") return (u.pathname.split("/")[1] || "").slice(0, 11) || null;
      if (host === "youtube.com" || host === "youtube-nocookie.com") {
        if (u.searchParams.get("v")) return u.searchParams.get("v").slice(0, 11);
        const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{11})/);
        if (m) return m[1];
      }
    } catch {}
    return null;
  }
  function findAll(obj, key, out = []) {
    if (!obj || typeof obj !== "object") return out;
    if (obj[key]) out.push(obj[key]);
    for (const v of Object.values(obj)) if (v && typeof v === "object") findAll(v, key, out);
    return out;
  }
  const txt = t => !t ? "" : t.simpleText || (t.runs || []).map(r => r.text).join("");
  const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  let atpVid = null, atpBusy = false, atpT = null;
  const atpMsg = (t, bad) => { $("atpMsg").textContent = t || ""; $("atpMsg").classList.toggle("bad", !!bad); };

  function atpOpen(prefill) {
    ensureYTM();
    $("atp").hidden = false;
    if (prefill) { $("atpUrl").value = prefill; atpLoad(); }
    else if (!atpVid) { atpMsg("Paste a link to any YouTube video, or use the song that's playing."); $("atpList").replaceChildren(); }
    setTimeout(() => $("atpUrl").focus(), 30);
  }
  function atpClose() { $("atp").hidden = true; $("atpOpen").focus(); }

  async function atpLoad() {
    const id = videoIdFrom($("atpUrl").value);
    $("atpNew").hidden = true;
    if (!id) { atpVid = null; $("atpVid").hidden = true; $("atpList").replaceChildren(); atpMsg($("atpUrl").value.trim() ? "That doesn't look like a YouTube link." : "Paste a link to any YouTube video, or use the song that's playing.", !!$("atpUrl").value.trim()); return; }
    if (atpVid === id && $("atpList").children.length) return;
    atpVid = id;
    $("atpVid").hidden = false;
    $("atpThumb").src = `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
    $("atpVTitle").textContent = "Loading…"; $("atpVBy").textContent = "";
    D.ytInfo(id).then(i => { if (atpVid !== id) return; $("atpVTitle").textContent = (i && i.title) || "YouTube video"; $("atpVBy").textContent = (i && i.author) || ""; }).catch(() => {});
    atpMsg("Loading your playlists…");
    $("atpList").replaceChildren();
    try {
      const j = await ytApi("playlist/get_add_to_playlist", { videoIds: [id] });
      if (atpVid !== id) return;
      const pls = findAll(j, "playlistAddToOptionRenderer");
      const list = $("atpList");
      const nb = mk("button", "atp-pl newpl"); nb.type = "button";
      nb.innerHTML = '<span class="ck" style="border-style:dashed"></span>'; nb.append(mk("span", "nm", "New playlist…"));
      nb.onclick = () => { $("atpNew").hidden = false; $("atpNewName").focus(); };
      list.append(nb);
      pls.forEach(p => {
        const b = mk("button", "atp-pl" + (p.containsSelectedVideos === "ALL" ? " on" : "")); b.type = "button";
        const ck = mk("span", "ck"); ck.innerHTML = CHECK;
        b.append(ck, mk("span", "nm", txt(p.title) || "Playlist"));
        b.setAttribute("aria-pressed", p.containsSelectedVideos === "ALL");
        b.onclick = () => atpToggle(b, p.playlistId, id, txt(p.title));
        list.append(b);
      });
      atpMsg(pls.length ? "Tick a playlist to add it, tick again to remove." : "No playlists yet. Make one with New playlist.");
    } catch (e) { if (atpVid === id) atpMsg(e.message, true); }
  }
  async function atpToggle(b, playlistId, id, name) {
    if (!playlistId) return;
    const adding = !b.classList.contains("on");
    b.classList.add("busy");
    try {
      const action = adding ? { action: "ACTION_ADD_VIDEO", addedVideoId: id } : { action: "ACTION_REMOVE_VIDEO_BY_VIDEO_ID", removedVideoId: id };
      const j = await ytApi("browse/edit_playlist", { playlistId: playlistId.replace(/^VL/, ""), actions: [action] });
      if (j && j.status && !/SUCCEEDED/.test(j.status)) throw new Error("YouTube Music didn't accept that.");
      b.classList.toggle("on", adding); b.setAttribute("aria-pressed", adding);
      atpMsg((adding ? "Added to " : "Removed from ") + name + ".");
      toast((adding ? "Added to " : "Removed from ") + name);
    } catch (e) { atpMsg(e.message, true); }
    finally { b.classList.remove("busy"); }
  }
  $("atpNew").addEventListener("submit", async e => {
    e.preventDefault();
    const name = $("atpNewName").value.trim(), id = atpVid;
    if (!name || !id) return;
    try {
      atpMsg("Creating " + name + "…");
      await ytApi("playlist/create", { title: name, privacyStatus: "PRIVATE", videoIds: [id] });
      $("atpNewName").value = ""; $("atpNew").hidden = true;
      toast("Created " + name);
      atpVid = null; atpLoad();
    } catch (err) { atpMsg(err.message, true); }
  });
  $("atpOpen").onclick = async () => {
    if (ytView === "yt") { const id = await currentVideoId(); if (id) { atpVid = null; return atpOpen("https://www.youtube.com/watch?v=" + id); } }
    atpOpen();
  };
  $("atpClose").onclick = atpClose;
  $("atp").addEventListener("mousedown", e => { if (e.target === $("atp")) atpClose(); });
  $("atp").addEventListener("keydown", e => { if (e.key === "Escape") { e.stopPropagation(); atpClose(); } });
  $("atpUrl").addEventListener("input", () => { clearTimeout(atpT); atpT = setTimeout(atpLoad, 300); });
  $("atpUrl").addEventListener("paste", () => { clearTimeout(atpT); atpT = setTimeout(atpLoad, 50); });
  const currentVideoId = async () => {
    const wv = ytView === "yt" && ytv ? ytv : yt;
    if (!wv) return "";
    try {
      return await wv.executeJavaScript(`(() => { const m = location.href.match(/[?&]v=([\\w-]{11})|\\/shorts\\/([\\w-]{11})/); if (m) return m[1] || m[2]; if (location.hostname.startsWith("music.")) { const p = document.getElementById("movie_player"); const d = p && p.getVideoData && p.getVideoData(); if (d && d.video_id) return d.video_id; } return ""; })()`) || "";
    } catch { return ""; }
  };
  $("atpCur").onclick = async () => {
    try {
      const id = await currentVideoId();
      if (!id) return atpMsg("Nothing is playing right now.", true);
      $("atpUrl").value = "https://music.youtube.com/watch?v=" + id; atpVid = null; atpLoad();
    } catch { atpMsg("Nothing is playing in YouTube Music.", true); }
  };

  /* ---------- Search: find songs/videos on YouTube and add them to a playlist (no recommendations) ---------- */
  const YTS_PARAMS = { songs: "EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D", videos: "EgWKAQIQAWoKEAkQChAFEAMQBA%3D%3D" };
  let ytsKind = store.get("yts.kind") === "videos" ? "videos" : "songs", ytsSeq = 0;
  const PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M3 6h11M3 12h11M3 18h6M17 13v8M13 17h8"/></svg>';
  const PLAY_S = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  function ytsParse(j) {
    return findAll(j, "musicResponsiveListItemRenderer").map(r => {
      const cols = (r.flexColumns || []).map(c => c.musicResponsiveListItemFlexColumnRenderer && c.musicResponsiveListItemFlexColumnRenderer.text);
      const id = (r.playlistItemData && r.playlistItemData.videoId) || (findAll(r, "watchEndpoint")[0] || {}).videoId;
      const title = txt(cols[0]);
      const parts = ((cols[1] && cols[1].runs) || []).map(x => x.text).join("").split(" • ").map(x => x.trim()).filter(Boolean);
      if (/^(song|video|episode)$/i.test(parts[0] || "")) parts.shift();
      const dur = parts.length && /^\d+:\d{2}(:\d{2})?$/.test(parts[parts.length - 1]) ? parts.pop() : "";
      const th = findAll(r, "thumbnails")[0] || [];
      const thumb = th.length ? th[th.length - 1].url : "";
      return id && title ? { id, title, by: parts.slice(0, 2).join(" · "), dur, thumb } : null;
    }).filter(Boolean);
  }
  async function ytsSearch() {
    const q = $("ytsQ").value.trim(), seq = ++ytsSeq;
    const list = $("ytsList");
    if (!q) { list.replaceChildren(); $("ytsMsg").textContent = "Search YouTube for any song or video, then add it to a playlist."; return; }
    $("ytsMsg").textContent = "Searching…";
    try {
      ensureYTM();
      const j = await ytApi("search", { query: q, params: YTS_PARAMS[ytsKind] });
      if (seq !== ytsSeq) return;
      const items = ytsParse(j);
      list.replaceChildren();
      $("ytsMsg").textContent = items.length ? "" : "No results.";
      items.slice(0, 30).forEach(it => {
        const row = mk("div", "yts-row");
        const im = mk("img", "yts-th" + (ytsKind === "videos" ? " wide" : "")); im.alt = ""; im.loading = "lazy"; im.referrerPolicy = "no-referrer"; if (it.thumb) im.src = it.thumb;
        const tx = mk("div", "yts-tx"); tx.append(mk("b", "", it.title), mk("span", "", [it.by, it.dur].filter(Boolean).join(" · ")));
        const play = mk("button", "ib yts-b"); play.type = "button"; play.innerHTML = PLAY_S; play.setAttribute("aria-label", "Play " + it.title);
        play.onclick = () => { playOnYTM(it.id); toast("Playing " + it.title); };
        const add = mk("button", "ib yts-b add"); add.type = "button"; add.innerHTML = PLUS; add.setAttribute("aria-label", "Add " + it.title + " to a playlist");
        add.onclick = () => { atpVid = null; atpOpen("https://www.youtube.com/watch?v=" + it.id); };
        row.append(im, tx, play, add);
        list.append(row);
      });
    } catch (e) { if (seq === ytsSeq) { list.replaceChildren(); $("ytsMsg").textContent = e.message; } }
  }
  function renderYtsKind() { document.querySelectorAll("#ytsKind button").forEach(b => b.setAttribute("aria-checked", b.dataset.k === ytsKind)); }
  document.querySelectorAll("#ytsKind button").forEach(b => b.addEventListener("click", () => { ytsKind = b.dataset.k; store.set("yts.kind", ytsKind); renderYtsKind(); ytsSearch(); }));
  $("ytsForm").addEventListener("submit", e => { e.preventDefault(); ytsSearch(); });
  renderYtsKind();

  /* ---------- Library: your playlists and albums in Sothis's style (YouTube Music runs hidden as the engine) ---------- */
  let ytSite = false, ytlKind = store.get("ytl.kind") === "albums" ? "albums" : "playlists";
  const ytlCache = {};
  let ytlDetail = null, ytlFwd = null, ytlSeq = 0;
  const YTL_BROWSE = { playlists: "FEmusic_liked_playlists", albums: "FEmusic_liked_albums" };
  function libParse(j) {
    const seen = new Set();
    return findAll(j, "musicTwoRowItemRenderer").map(r => {
      const be = findAll(r.navigationEndpoint || {}, "browseEndpoint")[0];
      const id = be && be.browseId;
      const th = findAll(r, "thumbnails")[0] || [];
      return id ? { id, title: txt(r.title), sub: txt(r.subtitle), thumb: th.length ? th[th.length - 1].url : "" } : null;
    }).filter(x => x && !seen.has(x.id) && seen.add(x.id) && x.id !== "VLLM" && x.id !== "VLSE" && (x.id.startsWith("VL") || x.id.startsWith("MPRE")));
  }
  function trackParse(j) {
    return findAll(j, "musicResponsiveListItemRenderer").map(r => {
      const cols = (r.flexColumns || []).map(c => c.musicResponsiveListItemFlexColumnRenderer && c.musicResponsiveListItemFlexColumnRenderer.text);
      const id = (r.playlistItemData && r.playlistItemData.videoId) || (findAll(r, "watchEndpoint")[0] || {}).videoId;
      const fixed = (r.fixedColumns || []).map(c => txt(c.musicResponsiveListItemFixedColumnRenderer && c.musicResponsiveListItemFixedColumnRenderer.text)).filter(Boolean);
      const th = findAll(r, "thumbnails")[0] || [];
      const by = cols.slice(1).map(txt).filter(Boolean).join(" · ").replace(/^(Song|Video) · /, "");
      return id && txt(cols[0]) ? { id, title: txt(cols[0]), by, dur: fixed[0] || "", thumb: th.length ? th[th.length - 1].url : "" } : null;
    }).filter(Boolean);
  }
  // YouTube Music's "Autoplay" keeps adding similar songs after (and into) a playlist; switch it off when playing a list
  const AUTOPLAY_OFF = `(() => {
    const t = [...document.querySelectorAll("ytmusic-player-queue tp-yt-paper-toggle-button, ytmusic-player-queue [role=switch], #automix, tp-yt-paper-toggle-button")]
      .find(el => /autoplay/i.test((el.getAttribute("aria-label") || "") + " " + (el.closest("[class*=automix], ytmusic-player-queue *") ? el.closest("*").textContent : "") + " " + (el.parentElement ? el.parentElement.textContent : "")));
    if (!t) return false;
    const on = t.hasAttribute("checked") || t.getAttribute("aria-pressed") === "true" || t.getAttribute("aria-checked") === "true" || t.active === true;
    if (on) t.click();
    return true;
  })()`;
  // play a song: switch inside YouTube Music's own page first (works while something is playing); a full page load if that didn't take
  const ytmGoJs = (vid, list) => `(() => {
    const app = document.querySelector("ytmusic-app"); if (!app) return false;
    const ep = { watchEndpoint: Object.assign({ videoId: ${JSON.stringify(vid)} }, ${JSON.stringify(list || "")} ? { playlistId: ${JSON.stringify(list || "")} } : {}) };
    try { if (typeof app.navigate === "function") { app.navigate(ep); return true; } } catch (e) {}
    try { app.dispatchEvent(new CustomEvent("yt-navigate", { bubbles: true, composed: true, detail: { endpoint: ep } })); return true; } catch (e) {}
    return false;
  })()`;
  const ytmVidJs = `(() => { try { return document.getElementById("movie_player").getVideoData().video_id || ""; } catch (e) { return ""; } })()`;
  const ytmHard = (vid, list) => { try { yt.executeJavaScript("window.onbeforeunload = null", true).catch(() => {}); yt.loadURL("https://music.youtube.com/watch?v=" + vid + (list ? "&list=" + encodeURIComponent(list) : "")).catch(() => {}); } catch { toast("YouTube Music isn't ready yet"); } };
  const playOnYTM = (vid, list) => {
    ensureYTM();
    if (!yt) { toast("YouTube Music isn't ready yet"); return; }
    yt.executeJavaScript(ytmGoJs(vid, list), true).then(ok => {
      if (!ok) return ytmHard(vid, list);
      setTimeout(() => yt.executeJavaScript(ytmVidJs).then(cur => { if (cur !== vid) ytmHard(vid, list); }).catch(() => ytmHard(vid, list)), 1800);
    }).catch(() => ytmHard(vid, list));
    if (list) { let n = 0; const off = () => yt.executeJavaScript(AUTOPLAY_OFF).then(ok => { if (!ok && ++n < 8) setTimeout(off, 1200); }).catch(() => {}); setTimeout(off, 2000); }
  };
  function trackRow(it, listId, wide) {
    const row = mk("div", "yts-row");
    const im = mk("img", "yts-th" + (wide ? " wide" : "")); im.alt = ""; im.loading = "lazy"; im.referrerPolicy = "no-referrer"; if (it.thumb) im.src = it.thumb;
    const tx = mk("div", "yts-tx"); tx.append(mk("b", "", it.title), mk("span", "", it.by || ""));
    const dur = mk("span", "yts-dur", it.dur || "");
    const play = mk("button", "ib yts-b"); play.type = "button"; play.innerHTML = PLAY_S; play.setAttribute("aria-label", "Play " + it.title);
    play.onclick = () => { playOnYTM(it.id, listId); toast("Playing " + it.title); };
    const add = mk("button", "ib yts-b add"); add.type = "button"; add.innerHTML = PLUS; add.setAttribute("aria-label", "Add " + it.title + " to a playlist");
    add.onclick = () => { atpVid = null; atpOpen("https://www.youtube.com/watch?v=" + it.id); };
    row.append(im, tx, dur, play, add);
    row.addEventListener("dblclick", () => play.click());
    return row;
  }
  async function ytlLoad(force) {
    const seq = ++ytlSeq, kind = ytlKind, list = $("ytlList");
    $("ytlDetail").hidden = true; list.hidden = false; $("ytlKind").hidden = false;
    if (ytlCache[kind] && !force) return ytlRenderList(ytlCache[kind]);
    list.replaceChildren(); $("ytlMsg").textContent = "Loading your " + kind + "…";
    try {
      const items = libParse(await ytApi("browse", { browseId: YTL_BROWSE[kind] }));
      if (seq !== ytlSeq) return;
      ytlCache[kind] = items; ytlRenderList(items);
    } catch (e) { if (seq === ytlSeq) $("ytlMsg").textContent = e.message; }
  }
  function ytlRenderList(items) {
    const list = $("ytlList"); list.replaceChildren(); list.classList.add("ytl-grid");
    $("ytlMsg").textContent = items.length ? "" : ytlKind === "albums" ? "No saved albums yet." : "No playlists yet.";
    items.forEach(it => {
      const row = mk("button", "ytl-item"); row.type = "button";
      const im = mk("img", "ytl-th"); im.alt = ""; im.loading = "lazy"; im.referrerPolicy = "no-referrer"; if (it.thumb) im.src = it.thumb;
      const tx = mk("div", "yts-tx"); tx.append(mk("b", "", it.title), mk("span", "", (it.sub || "").replace(/^(Playlist|Album|EP|Single)\s*•\s*/i, "")));
      const chev = mk("span", "ytl-chev"); chev.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>';
      row.append(im, tx, chev);
      row.onclick = () => { ytlFwd = null; ytlOpen(it); };
      list.append(row);
    });
    ytNavState();
  }
  async function ytlOpen(it) {
    const seq = ++ytlSeq;
    ytlDetail = it;
    $("ytlList").hidden = true; $("ytlKind").hidden = true; $("ytlDetail").hidden = false;
    $("ytlDTitle").textContent = it.title; $("ytlDSub").textContent = it.sub || "";
    const dth = $("ytlDThumb"); if (it.thumb) dth.src = it.thumb; else dth.removeAttribute("src");
    const tl = $("ytlTracks"); tl.replaceChildren(); $("ytlMsg").textContent = "Loading…";
    $("ytlPlayAll").disabled = true;
    $("ytlShuffle").disabled = true;
    ytNavState();
    try {
      const j = await ytApi("browse", { browseId: it.id });
      if (seq !== ytlSeq) return;
      const tracks = trackParse(j);
      // long playlists come in pages of about 100 songs: keep asking for the next page until there are no more
      const nextTok = o => { const c = findAll(o, "continuationCommand").map(x => x.token).concat(findAll(o, "nextContinuationData").map(x => x.continuation)).filter(Boolean); return c[c.length - 1] || ""; };
      const seenTok = new Set();
      const shelf = findAll(j, "musicPlaylistShelfRenderer")[0] || findAll(j, "musicShelfRenderer")[0] || null;
      let tok = shelf ? nextTok(shelf) : "";
      for (let page = 0; tok && !seenTok.has(tok) && page < 60; page++) {
        seenTok.add(tok);
        $("ytlMsg").textContent = `Loading… ${tracks.length} songs`;
        let more = null;
        try { more = await ytApi("browse", { continuation: tok }); } catch { break; }
        if (seq !== ytlSeq) return;
        const part = findAll(more, "appendContinuationItemsAction")[0] || findAll(more, "musicPlaylistShelfContinuation")[0] || findAll(more, "musicShelfContinuation")[0] || more || {};
        const add = trackParse(part);
        if (!add.length) break;
        tracks.push(...add);
        tok = nextTok(part);
      }
      const wpe = findAll(j, "watchPlaylistEndpoint")[0];
      // use the playlist itself; never a "radio"/mix (RD…) list, which fills up with random songs
      const okList = id => id && !/^RD/.test(id);
      const listId = (it.id.startsWith("VL") ? it.id.slice(2) : "") || [wpe && wpe.playlistId, ...findAll(j, "watchPlaylistEndpoint").map(w => w.playlistId), ...findAll(j, "watchEndpoint").map(w => w.playlistId)].find(okList) || "";
      $("ytlMsg").textContent = tracks.length ? "" : "This one is empty.";
      tracks.forEach(t => tl.append(trackRow(t, listId)));
      $("ytlPlayAll").disabled = !tracks.length;
      $("ytlPlayAll").onclick = () => { if (tracks[0]) { playOnYTM(tracks[0].id, listId); toast("Playing " + it.title); } };
      $("ytlShuffle").disabled = !tracks.length;
      $("ytlShuffle").onclick = () => {
        if (!tracks.length) return;
        const pick = tracks[Math.floor(Math.random() * tracks.length)];
        playOnYTM(pick.id, listId);
        toast("Shuffling " + it.title);
        // turn on YouTube Music's own shuffle once the song has loaded, so the rest of the list plays in random order
        let tries = 0;
        const turnOn = () => {
          yt.executeJavaScript(`(() => { const b = document.querySelector("ytmusic-player-bar .shuffle, ytmusic-player-bar [aria-label='Shuffle']"); if (!b) return false; if (!b.classList.contains("active") && b.getAttribute("aria-pressed") !== "true") b.click(); return true; })()`)
            .then(ok => { if (!ok && ++tries < 8) setTimeout(turnOn, 1000); }).catch(() => {});
        };
        setTimeout(turnOn, 1500);
      };
    } catch (e) { if (seq === ytlSeq) $("ytlMsg").textContent = e.message; }
  }
  function ytlBack() { if (!ytlDetail) return; ytlFwd = ytlDetail; ytlDetail = null; ytlLoad(); }
  function renderYtlKind() { document.querySelectorAll("#ytlKind button").forEach(b => b.setAttribute("aria-checked", b.dataset.k === ytlKind)); }
  document.querySelectorAll("#ytlKind button").forEach(b => b.addEventListener("click", () => { ytlKind = b.dataset.k; store.set("ytl.kind", ytlKind); renderYtlKind(); ytlDetail = null; ytlLoad(); }));
  renderYtlKind();
  $("ytSite").onclick = () => { ytSite = !ytSite; showYtView(ytView); if (!ytSite) { ytlCache.playlists = ytlCache.albums = null; if (ytView === "music") ytlLoad(true); } };
  // The real site only appears when you need to sign in; the button (top right) closes it again.
  function showSignIn() {
    if (ytSite) return;
    const go = () => { ytSite = true; showYtView(ytView); try { yt.loadURL("https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fmusic.youtube.com%2F"); } catch {} toast("Sign in, then tap the globe to go back"); };
    setTimeout(() => {
      for (const id of ["ytlMsg", "ytsMsg"]) {
        const el = $(id); if (!el || el.querySelector("button")) continue;
        const b = mk("button", "btn yts-signin", "Sign in"); b.type = "button"; b.onclick = go;
        el.append(" ", b);
      }
    }, 0);
  }

  // Now-playing bar under Library and Search
  // the album's main color, read from a small copy of the cover, for the glow behind Sothis
  let glowFor = "";
  function songGlow(url) {
    if (url === glowFor) return; glowFor = url;
    const set = c => document.querySelector(".shell").style.setProperty("--song-glow", c);
    if (!url) return set("rgba(0, 0, 0, 0)");
    const im = new Image(); im.crossOrigin = "anonymous"; im.referrerPolicy = "no-referrer";
    im.onload = () => {
      if (glowFor !== url) return;
      try {
        const c = document.createElement("canvas"); c.width = c.height = 24; const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(im, 0, 0, 24, 24);
        const d = x.getImageData(0, 0, 24, 24).data; let r = 0, g = 0, b = 0, w = 0;
        for (let i = 0; i < d.length; i += 4) { const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]), sat = mx - mn, k = 1 + sat * sat / 900; r += d[i] * k; g += d[i + 1] * k; b += d[i + 2] * k; w += k; }
        // never a white or grey glow: pale or washed-out covers get none, and bright colors are toned down
        let R = r / w, G = g / w, B = b / w; const mx = Math.max(R, G, B), mn = Math.min(R, G, B), sat = mx ? (mx - mn) / mx : 0;
        if (sat < 0.3 || mx < 40) return set("rgba(0, 0, 0, 0)");
        const k = Math.min(1, 170 / mx); R *= k; G *= k; B *= k;
        set(`rgba(${Math.round(R)}, ${Math.round(G)}, ${Math.round(B)}, .3)`);
      } catch { set("rgba(0, 0, 0, 0)"); }
    };
    im.onerror = () => set("rgba(0, 0, 0, 0)");
    im.src = url;
  }
  function renderYnp() {
    const y = ytState && ytState.has ? ytState : null;
    $("ynpT").textContent = y ? y.title : "Nothing playing";
    $("ynpA").textContent = y ? y.artist : "Pick a song from your library or search";
    if (y && y.art) { if ($("ynpArt").getAttribute("src") !== y.art) { const im = $("ynpArt"); im.src = y.art; im.classList.remove("swap"); void im.offsetWidth; im.classList.add("swap"); songGlow(y.art); } } else { $("ynpArt").removeAttribute("src"); songGlow(""); }
    $("ynpFill").style.width = (y && y.dur ? Math.min(100, y.pos / y.dur * 100) : 0) + "%";
    $("ynpPlayI").innerHTML = y && y.playing ? PAUSE : PLAY;
    $("ynpPlay").setAttribute("aria-label", y && y.playing ? "Pause" : "Play");
    ["ynpPrev", "ynpPlay", "ynpNext"].forEach(id => $(id).disabled = !y);
  }
  setInterval(() => { if (tab === "ytm") renderYnp(); }, 1000);
  $("ynpPlay").onclick = () => ytCmd("playpause");
  $("ynpPrev").onclick = () => ytCmd("prev");
  $("ynpNext").onclick = () => ytCmd("next");
  $("ynpBar").addEventListener("click", e => { const r = $("ynpBar").getBoundingClientRect(); ytCmd("seek", (e.clientX - r.left) / r.width); });

  /* ---------- Music visualizer: the crest pulses with the bass, a ring of bars dances around it ---------- */
  // Reads YouTube Music's audio through a copy of its stream (captureStream), so playback itself is never touched.
  const VIZ_JS = `(() => {
    const S = window.__sv || (window.__sv = {});
    const v = document.querySelector("video");
    if (!v || v.paused) return null;
    try {
      if (!S.ctx) S.ctx = new AudioContext();
      if (S.ctx.state === "suspended") S.ctx.resume();
      const t = S.stream && S.stream.getAudioTracks()[0];
      if (S.v !== v || !t || t.readyState === "ended") {
        S.stream = v.captureStream();
        if (!S.stream.getAudioTracks().length) return null;
        try { S.src && S.src.disconnect(); } catch (e) {}
        S.src = S.ctx.createMediaStreamSource(S.stream);
        S.an = S.ctx.createAnalyser(); S.an.fftSize = 512; S.an.smoothingTimeConstant = 0.7;
        S.src.connect(S.an); S.buf = new Uint8Array(S.an.frequencyBinCount); S.v = v;
      }
      S.an.getByteFrequencyData(S.buf);
      const n = S.buf.length, out = [];
      for (let i = 0; i < 32; i++) {
        const a = Math.floor(Math.pow(i / 32, 1.8) * n * 0.7), b = Math.max(a + 1, Math.floor(Math.pow((i + 1) / 32, 1.8) * n * 0.7));
        let m = 0; for (let k = a; k < b; k++) m = Math.max(m, S.buf[k]);
        out.push(m);
      }
      return out;
    } catch (e) { return null; }
  })()`;
  let vizOn = store.get("viz") !== "0", vizBusy = false, vizLive = false, vizBass = 0;
  const vizBands = new Array(32).fill(0);
  const vizCv = $("vizRing"), vizCx = vizCv.getContext("2d"), shellEl = $("shell");
  function vizDraw() {
    const dpr = window.devicePixelRatio || 1, W = vizCv.clientWidth, H = vizCv.clientHeight;
    if (!W) return;
    if (vizCv.width !== Math.round(W * dpr)) { vizCv.width = Math.round(W * dpr); vizCv.height = Math.round(H * dpr); }
    const c = vizCx; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2, R0 = W * 0.36, L = W * 0.13, N = 64;
    c.lineCap = "round"; c.lineWidth = Math.max(2, W / 150);
    for (let i = 0; i < N; i++) {
      const band = vizBands[i < N / 2 ? i : N - 1 - i] / 255;
      const len = 3 + Math.pow(band, 1.6) * L;
      const ang = -Math.PI / 2 + (i / N) * Math.PI * 2;
      const x0 = cx + Math.cos(ang) * R0, y0 = cy + Math.sin(ang) * R0;
      const x1 = cx + Math.cos(ang) * (R0 + len), y1 = cy + Math.sin(ang) * (R0 + len);
      c.strokeStyle = `rgba(255, ${40 + band * 60 | 0}, ${55 + band * 40 | 0}, ${0.25 + band * 0.7})`;
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    }
    shellEl.style.setProperty("--beat", (1 + vizBass * 0.045).toFixed(4));
    shellEl.style.setProperty("--vglow", Math.min(1, Math.pow(vizBass, 1.4) * 1.1).toFixed(3));
    shellEl.style.setProperty("--gs", (0.88 + vizBass * 0.28).toFixed(3));
  }
  function vizStop() {
    if (!vizLive) return;
    vizLive = false; document.body.classList.remove("viz-on");
    vizBands.fill(0); vizBass = 0;
    shellEl.style.setProperty("--beat", "1"); shellEl.style.setProperty("--vglow", "0");
    setTimeout(() => { if (!vizLive) vizCx.clearRect(0, 0, vizCv.width, vizCv.height); }, 700);
  }
  async function vizTick() {
    if (!vizOn || mini || !musWv() || document.hidden || document.body.classList.contains("splashing") || !(ytState && ytState.playing)) { vizStop(); return; }
    if (vizBusy) return;
    vizBusy = true;
    try {
      const b = await musWv().executeJavaScript(VIZ_JS, true);
      if (!b) { vizStop(); return; }
      for (let i = 0; i < 32; i++) vizBands[i] = Math.max(b[i], vizBands[i] * 0.82);
      const bass = (b[0] + b[1] + b[2] + b[3]) / (4 * 255);
      vizBass = Math.max(bass, vizBass * 0.86);
      if (!vizLive) { vizLive = true; document.body.classList.add("viz-on"); }
      vizDraw();
    } catch { vizStop(); }
    finally { vizBusy = false; }
  }
  setInterval(vizTick, 40);
  $("setViz").setAttribute("aria-checked", vizOn);
  $("setViz").onclick = () => { vizOn = !vizOn; store.set("viz", vizOn ? "1" : "0"); $("setViz").setAttribute("aria-checked", vizOn); if (!vizOn) vizStop(); };

  /* ---------- Mouse battery history (hover the battery badge) ---------- */
  let bhT = null, bhOpen = false;
  function bhFmtLeft(h) {
    if (h >= 48) return "about " + Math.round(h / 24) + " days left";
    if (h >= 20) return "about a day left";
    if (h >= 2) return "about " + Math.round(h) + " hours left";
    return "under 2 hours left";
  }
  async function bhShow() {
    clearTimeout(bhT);
    const pop = $("bhPop");
    if (!bhOpen) { bhOpen = true; pop.hidden = false; requestAnimationFrame(() => pop.classList.add("on")); }
    let data = { points: [], estimate: null };
    try { data = await D.battHistory(); } catch {}
    const ok = batt.state === "ok";
    $("bhPct").textContent = ok ? batt.percent + "%" : "—";
    const e = data.estimate;
    $("bhSub").textContent = !ok ? (STATES[batt.state] || ["Mouse not found"])[0]
      : batt.charging ? "Charging"
      : e && e.hoursLeft ? bhFmtLeft(e.hoursLeft)
      : "On battery · learning how fast it drains";
    // chart: last 3 days
    const now = Date.now(), span = 3 * 864e5, W = 240, H = 64;
    const pts = (data.points || []).filter(p => p.t >= now - span);
    const svg = $("bhChart");
    if (pts.length < 2) { svg.innerHTML = `<text x="${W / 2}" y="${H / 2 + 4}" text-anchor="middle" class="bh-none">History builds up over the next few hours</text>`; return; }
    const X = t => ((t - (now - span)) / span) * W, Y = p => H - 4 - (p / 100) * (H - 8);
    let line = "", area = `M${X(pts[0].t).toFixed(1)},${H}`;
    pts.forEach((p, i) => { const s = `${X(p.t).toFixed(1)},${Y(p.p).toFixed(1)}`; line += (i ? " L" : "M") + s; area += " L" + s; });
    area += ` L${X(pts[pts.length - 1].t).toFixed(1)},${H} Z`;
    const charge = pts.filter(p => p.c).map(p => `<circle cx="${X(p.t).toFixed(1)}" cy="${Y(p.p).toFixed(1)}" r="1.6" class="bh-chg"/>`).join("");
    const grid = [25, 50, 75].map(v => `<line x1="0" x2="${W}" y1="${Y(v)}" y2="${Y(v)}" class="bh-grid"/>`).join("");
    svg.innerHTML = `<defs><linearGradient id="bhG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgba(227,25,47,.45)"/><stop offset="1" stop-color="rgba(227,25,47,0)"/></linearGradient></defs>${grid}<path d="${area}" fill="url(#bhG)"/><path d="${line}" class="bh-line"/>${charge}`;
  }
  function bhHide(delay) {
    clearTimeout(bhT);
    bhT = setTimeout(() => { bhOpen = false; const pop = $("bhPop"); pop.classList.remove("on"); setTimeout(() => { if (!bhOpen) pop.hidden = true; }, 180); }, delay ?? 160);
  }
  $("battBadge").addEventListener("mouseenter", bhShow);
  $("battBadge").addEventListener("mouseleave", () => bhHide());
  $("battBadge").addEventListener("focus", bhShow);
  $("battBadge").addEventListener("blur", () => bhHide(0));
  $("bhPop").addEventListener("mouseenter", () => clearTimeout(bhT));
  $("bhPop").addEventListener("mouseleave", () => bhHide());

