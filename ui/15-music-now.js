  // ---------- Music: "Now playing" view (the minimal mockup) ----------
  // Album art, title, a hairline progress bar and Prev / Play / Next on the left; big synced lyrics on the right
  // (tap a line to jump there). It's a third button in the Music switch, before Library and Search, and Sothis
  // remembers whether you left it on ("music.np"). Uses the same song state and lyrics as the lyrics panel.
  (() => {
    const tabEl = $("tab-ytm"), sw = $("ytSw"), bar = tabEl && tabEl.querySelector(".ytbar");
    if (!tabEl || !sw || !bar || $("mnp")) return;

    const npb = document.createElement("button");
    npb.type = "button"; npb.setAttribute("role", "radio"); npb.dataset.yv = "np"; npb.setAttribute("aria-checked", "false");
    npb.textContent = "Now playing";
    sw.prepend(npb);

    const v = document.createElement("div");
    v.className = "mnp"; v.id = "mnp"; v.hidden = true;
    v.innerHTML =
      '<div class="mnp-l">' +
        '<div class="mnp-art"><img id="mnpArt" alt=""></div>' +
        '<div class="mnp-tx"><b id="mnpT">Nothing playing</b><span id="mnpA">Pick a song from your library or search</span></div>' +
        '<div class="mnp-bar" id="mnpBar" role="slider" tabindex="0" aria-label="Song position" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i id="mnpFill"></i></div>' +
        '<div class="mnp-time"><span id="mnpCur">0:00</span><span id="mnpDur">0:00</span></div>' +
        '<div class="mnp-ctl">' +
          '<button type="button" id="mnpPrev" aria-label="Previous"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h2v14H6zM20 5v14L9 12z"/></svg></button>' +
          '<button type="button" id="mnpPlay" aria-label="Play"><svg viewBox="0 0 24 24" fill="currentColor"><path id="mnpPlayI" d="M8 5v14l11-7z"/></svg></button>' +
          '<button type="button" id="mnpNext" aria-label="Next"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 5h2v14h-2zM4 5v14l11-7z"/></svg></button>' +
        '</div>' +
      '</div>' +
      '<div class="mnp-ly" id="mnpLy" aria-label="Lyrics"></div>';
    bar.after(v);

    let npOn = true;   // Music is always Now playing with your library beside it (the Library and Search buttons are gone)
    const fmt = s => { s = Math.max(0, Math.floor(+s || 0)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };

    function applyNp() {
      const on = npOn && !tabEl.classList.contains("svc");
      tabEl.classList.toggle("mnp-on", on);   // not "np": that class is the full-window news overlay
      v.hidden = !on;
      if (on) sw.querySelectorAll("button").forEach(b => b.setAttribute("aria-checked", String(b.dataset.yv === "np")));
      else npb.setAttribute("aria-checked", "false");
      if (on) render();
    }
    // the switch's own handler shows Library or Search; "np" shows Library underneath and covers it
    const showOrig = showYtView;
    showYtView = function (x) {
      if (x === "np") { npOn = true; store.set("music.np", "1"); showOrig("music"); }
      else showOrig(x);
      applyNp();
    };
    npb.addEventListener("click", () => showYtView("np"));
    sw.querySelectorAll('button:not([data-yv="np"])').forEach(b => b.addEventListener("click", () => { npOn = false; store.set("music.np", "0"); applyNp(); }));

    $("mnpPrev").onclick = () => ytCmd("prev");
    $("mnpNext").onclick = () => ytCmd("next");
    $("mnpPlay").onclick = () => ytCmd("playpause");
    $("mnpBar").addEventListener("click", e => { const r = $("mnpBar").getBoundingClientRect(); ytCmd("seek", (e.clientX - r.left) / r.width); });
    $("mnpBar").addEventListener("keydown", e => {
      const y = ytState && ytState.has ? ytState : null; if (!y || !y.dur) return;
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); ytCmd("seek", Math.max(0, Math.min(1, (y.pos + (e.key === "ArrowRight" ? 5 : -5)) / y.dur))); }
    });

    let lyFor = "", lyLines = [], npCur = -2;
    function renderLyrics(y) {
      const key = (y ? lyKey : "") + "|" + (lyLoading ? 1 : 0) + "|" + (lyData ? 1 : 0);
      if (key === lyFor) return;
      lyFor = key; npCur = -2;
      const box = $("mnpLy"); box.replaceChildren(); lyLines = [];
      const say = t => box.append(mk("p", "msg", t));
      if (!y) return say("Play a song to see its lyrics.");
      if (lyLoading) return say("Finding lyrics…");
      if (!lyData) return say("No lyrics found for this song.");
      if (lyData.instrumental) return say("Instrumental");
      if (!lyData.synced.length) { box.classList.add("plain"); for (const l of String(lyData.plain).split(/\n/)) box.append(mk("p", "", l || " ")); return; }
      box.classList.remove("plain");
      for (const [t, l] of lyData.synced) {
        const b = document.createElement("button"); b.type = "button"; b.textContent = l || "♪"; b.title = "Play from here";
        b.onclick = () => { lySeek(t); npCur = -2; };
        box.append(b); lyLines.push(b);
      }
    }
    function render() {
      const y = ytState && ytState.has ? ytState : null;
      $("mnpT").textContent = y ? y.title || "Nothing playing" : "Nothing playing";
      $("mnpA").textContent = y ? y.artist || "" : "Pick a song from your library or search";
      const im = $("mnpArt");
      if (y && y.art) { if (im.getAttribute("src") !== y.art) im.src = y.art; } else im.removeAttribute("src");
      const pct = y && y.dur ? Math.min(100, y.pos / y.dur * 100) : 0;
      $("mnpFill").style.width = pct + "%"; $("mnpBar").setAttribute("aria-valuenow", String(Math.round(pct)));
      $("mnpCur").textContent = fmt(y ? y.pos : 0); $("mnpDur").textContent = fmt(y ? y.dur : 0);
      $("mnpPlay").setAttribute("aria-label", y && y.playing ? "Pause" : "Play");
      $("mnpPlayI").setAttribute("d", y && y.playing ? "M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" : "M8 5v14l11-7z");
      ["mnpPrev", "mnpPlay", "mnpNext"].forEach(id => $(id).disabled = !y);
      try { lyFetch(); } catch {}
      renderLyrics(y);
    }
    setInterval(() => { if ((tab === "ytm" || (tab === "home" && document.body.classList.contains("hd-on"))) && !v.hidden) render(); }, 500);   // also on Home, where the dashboard shows it

    // keep the line that's playing lit and near the top third of the lyrics
    function tick() {
      requestAnimationFrame(tick);
      if (v.hidden || !lyLines.length || !lyData || !lyData.synced.length) return;
      const pos = lyPos(), L = lyData.synced; let i = -1;
      for (let n = 0; n < L.length; n++) { if (L[n][0] <= pos) i = n; else break; }
      if (i === npCur) return; npCur = i;
      lyLines.forEach((b, n) => { b.classList.toggle("on", n === i); b.classList.toggle("past", n < i); });
      if (i >= 0 && lyLines[i]) { const box = $("mnpLy"); box.scrollTop = lyLines[i].getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - box.clientHeight * 0.34; }
    }
    requestAnimationFrame(tick);
    applyNp();
  })();
