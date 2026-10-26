// Sothis for Crunchyroll: reads the episode details from the watch page and the time from the video player.
(() => {
  const top = window === window.top && location.hostname === "www.crunchyroll.com";
  const post = m => { try { chrome.runtime.sendMessage(m); } catch (e) {} };
  // the video (in the page, or in the player's own frame)
  setInterval(() => {
    const v = [...document.querySelectorAll("video")].find(x => x.duration > 30);
    if (v) post({ video: { time: v.currentTime, dur: v.duration, paused: v.paused || v.ended } });
  }, 3000);
  if (!top) return;
  const txt = el => (el && el.textContent || "").replace(/\s+/g, " ").trim();
  function ld() {
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        let j = JSON.parse(s.textContent); const all = Array.isArray(j) ? j : j["@graph"] || [j];
        const ep = all.find(x => x && /Episode/i.test(String(x["@type"])));
        if (ep) return ep;
      } catch (e) {}
    }
    return null;
  }
  let lastUrl = "";
  function meta() {
    const watch = /\/watch\//.test(location.pathname);
    if (!watch) { if (lastUrl && /\/watch\//.test(lastUrl)) post({ gone: true }); lastUrl = location.href; return; }
    lastUrl = location.href;
    const j = ld();
    let show = "", season = "", ep = "", title = "", img = "";
    if (j) {
      show = (j.partOfSeries && j.partOfSeries.name) || "";
      season = String((j.partOfSeason && (j.partOfSeason.seasonNumber || "")) || "");
      ep = String(j.episodeNumber || "");
      title = j.name || "";
      img = Array.isArray(j.image) ? j.image[0] : (j.image && j.image.url) || j.image || j.thumbnailUrl || "";
      if (Array.isArray(img)) img = img[0];
    }
    // what's on the page, for anything the page data left out
    const h1 = txt(document.querySelector("h1"));                                   // "E4 - Episode title"
    const m = /^(?:S(\d+)\s*)?E(\d+(?:\.\d+)?)\s*[-–]\s*(.*)$/i.exec(h1);
    if (m) { if (!ep) ep = m[2]; if (!title) title = m[3]; if (!season && m[1]) season = m[1]; }
    if (!show) show = txt(document.querySelector('a[href*="/series/"] h4, a[href*="/series/"] [class*="title"], a[href*="/series/"]'));
    if (!season) { const sm = /Season\s*(\d+)/i.exec(txt(document.querySelector('[class*="season"]')) || ""); if (sm) season = sm[1]; }
    if (!img) { const og = document.querySelector('meta[property="og:image"]'); if (og) img = og.content; }
    if (title && ep) title = title.replace(new RegExp("^E" + ep + "\\s*[-–]\\s*"), "");
    post({ meta: { watch: true, show: show.slice(0, 100), season: season.slice(0, 6), ep: ep.slice(0, 8), title: String(title).slice(0, 120), img: /^https:\/\//.test(img) ? img : "", url: location.href } });
  }
  setInterval(meta, 4000); meta();
  window.addEventListener("pagehide", () => post({ gone: true }));
})();
