  // ---------- Home: Notes sit in the side panel, under Last clip ----------
  // In the wide layout on Home, the Notes card moves into the side panel below your last clip; anywhere else
  // (other tabs, narrow window, compact) it goes back to its usual place on Home. Uses the side panel's own wdPut.
  (() => {
    const notes = document.querySelector("#tab-home .hm-notes"), side = $("wdSide"), clip = $("wdClip");
    if (!notes || !side || !clip || $("wdNotes")) return;
    notes.id = notes.id || "hmNotesBox";
    const slot = document.createElement("div");
    slot.className = "wd-slot"; slot.id = "wdNotes";
    clip.after(slot);
    const place = () => {
      const on = document.body.classList.contains("wd-has-side") && tab === "home";
      try { wdPut(notes.id, on ? slot : null); } catch {}
    };
    place(); setInterval(place, 400);
  })();

  // ---------- Home: big Clip it and Files buttons right under Notes (wherever Notes is: side panel or Home) ----------
  (() => {
    const notes = document.querySelector("#tab-home .hm-notes"), btn = $("hmClip");
    if (!notes || !btn || $("hmClipBig")) return;
    const box = document.createElement("div");
    box.className = "hm-clipbig"; box.id = "hmClipBig";
    box.append(btn);
    btn.classList.add("big");
    // the clips folder button goes right under it, same size, called "Files"
    const files = $("hmClipDir");
    if (files) {
      files.classList.add("big"); files.title = "Files"; files.setAttribute("aria-label", "Files");
      if (!files.querySelector("span")) { const t = document.createElement("span"); t.textContent = "Files"; files.append(t); }
      box.append(files);
    }
    const follow = () => { if (notes.nextElementSibling !== box) notes.after(box); };
    follow(); setInterval(follow, 400);
  })();
