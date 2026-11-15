  // ---------- Music: Search and Library in one place ----------
  // The switch no longer has a separate Search button. Library has a search box at the top; searching shows the
  // results (with Songs / Videos), and the × in the search box (or Esc) goes back to your library.
  (() => {
    const lib = $("ytlView"), sw = $("ytSw"), sForm = $("ytsForm"), sQ = $("ytsQ");
    if (!lib || !sw || !sForm || !sQ || $("mlibForm")) return;

    const f = document.createElement("form");
    f.className = "yts-form mlib-form"; f.id = "mlibForm"; f.setAttribute("role", "search");
    f.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>' +
      '<input type="search" id="mlibQ" placeholder="" autocomplete="off" spellcheck="false" aria-label="Search YouTube">';
    lib.prepend(f);
    sQ.placeholder = "";   // no hint text in either search box
    f.addEventListener("submit", e => {
      e.preventDefault();
      const q = $("mlibQ").value.trim(); if (!q) return;
      sQ.value = q; $("mlibQ").value = "";
      showYtView("yt"); ytsSearch();
    });

    // back to the library from the results
    const x = document.createElement("button");
    x.type = "button"; x.className = "ib mlib-x"; x.id = "mlibBack"; x.setAttribute("aria-label", "Back to your library"); x.title = "Back to your library";
    x.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    sForm.append(x);
    x.addEventListener("click", () => showYtView("music"));
    sQ.addEventListener("keydown", e => { if (e.key === "Escape") { e.preventDefault(); showYtView("music"); } });
    // a clear Back button above the results
    const back = document.createElement("button");
    back.type = "button"; back.className = "mlib-back"; back.id = "mlibBackBtn";
    back.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg><span>Library</span>';
    back.addEventListener("click", () => showYtView("music"));
    $("ytsView").prepend(back);

    // "Library" stays lit while you're looking at search results
    const prev = showYtView;
    showYtView = function (v) {
      prev(v);
      if (v === "yt") sw.querySelectorAll("button").forEach(b => b.setAttribute("aria-checked", String(b.dataset.yv === "music")));
    };
    // the old Search button: gone from the switch, but it still works if anything else asks for it
    const sb = sw.querySelector('button[data-yv="yt"]'); if (sb) sb.hidden = true;
  })();
