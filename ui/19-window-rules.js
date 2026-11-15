  // ---------- Window rules ----------
  // The minimize button sends Sothis to the taskbar as usual. "Always on top" is only for the compact
  // sidebar and the mini player: the main window is never pinned, and the small modes get back the pin you chose
  // for them (saved as "hd.pinSmall"; the mini player's pin button changes it).
  (() => {
    const small = () => document.body.classList.contains("is-mini") || document.body.classList.contains("is-compact");
    let pinSmall = store.get("hd.pinSmall") === null ? !!pinned : store.get("hd.pinSmall") === "1";
    let wasSmall = null, asked = 0;
    // the mini player's own pin button: remember what you pick there
    try { $("mPin").addEventListener("click", () => { if (small()) { pinSmall = !pinned; store.set("hd.pinSmall", pinSmall ? "1" : "0"); } }); } catch {}
    function check() {
      const s = small();
      const want = s ? pinSmall : false;
      if ((s !== wasSmall || pinned !== want) && Date.now() - asked > 1500) {
        wasSmall = s;
        if (pinned !== want) { asked = Date.now(); try { D.setPinned(want); } catch {} }
      }
    }
    check(); setInterval(check, 500);
  })();

  // ---------- Blackwall's CRT animation: power off when you minimize, power on when Sothis comes back ----------
  (() => {
    const shell = $("shell"); if (!shell) return;
    const fx = document.createElement("div"); fx.className = "crt-fx"; fx.setAttribute("aria-hidden", "true");
    shell.append(fx);
    const calm = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
    let away = false;
    function crt(kind, then) {
      if (calm() || document.body.classList.contains("is-mini") || document.body.classList.contains("is-compact")) { if (then) then(); return; }
      shell.classList.remove("crt-off", "crt-on"); void shell.offsetWidth; shell.classList.add("crt-" + kind);
      if (kind === "on") setTimeout(() => shell.classList.remove("crt-on"), 560);
      if (then) setTimeout(then, 480);
    }
    const minBtn = $("minBtn");
    if (minBtn) minBtn.onclick = () => crt("off", () => { away = true; D.minimize(); setTimeout(() => shell.classList.remove("crt-off"), 250); });
    // back from the taskbar or the tray
    const back = () => { if (away && !document.hidden) { away = false; crt("on"); } };
    document.addEventListener("visibilitychange", () => { if (document.hidden) away = true; else back(); });
    addEventListener("focus", back);
  })();
