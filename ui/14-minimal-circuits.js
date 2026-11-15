  // ---------- Minimal look + circuit background ----------
  // body.minimal = pure black, text tabs, thin type (css/08-minimal.css). The red circuit lines behind the window are
  // Blackwall's address bar circuits stretched across the shell; their sparks speed up while a game is live.
  // Both are switched from the titlebar's More menu and remembered in localStorage.
  (() => {
    const MK = "sothis.minimal", CK = "sothis.circuits";
    const get = (k) => { try { return localStorage.getItem(k) !== "0"; } catch (e) { return true; } };
    const put = (k, v) => { try { localStorage.setItem(k, v ? "1" : "0"); } catch (e) {} };
    const apply = () => {
      document.body.classList.toggle("minimal", get(MK));
      document.body.classList.toggle("no-circuits", !get(CK));
      for (const [k, id] of [[MK, "minimalBtn"], [CK, "circuitsBtn"]]) {
        const st = document.querySelector('#tbMenu [data-k="' + id + '"] .st');
        if (st) { st.textContent = get(k) ? "On" : "Off"; st.classList.toggle("on", get(k)); }
      }
    };

    // the traces: a few runs across the window with 45° jogs, drawn once in a 1600 × 1000 box stretched to fit
    const shell = document.getElementById("shell");
    if (shell && !shell.querySelector(".mcx")) {
      let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const rows = [70, 160, 250, 340, 430, 520, 610, 700, 790, 880, 950];
      let tr = "", pk = "", nd = "";
      rows.forEach((y0, i) => {
        let x = 0, y = y0, d = "M0 " + y;
        while (x < 1600) {
          x = Math.min(1600, x + 110 + Math.round(rnd() * 220)); d += " H" + x;
          if (x >= 1600) break;
          const dy = (rnd() < .5 ? -1 : 1) * (14 + Math.round(rnd() * 22));
          const ny = Math.max(y0 - 36, Math.min(y0 + 36, y + dy));
          x += Math.abs(ny - y); y = ny; d += " L" + x + " " + y;
          if (rnd() < .45) nd += '<circle class="nd" cx="' + x + '" cy="' + y + '" r="2"/>';
        }
        tr += '<path class="tr" d="' + d + '"/>';
        pk += '<path class="pk" d="' + d + '" pathLength="1600" style="animation-delay:-' + (rnd() * 12).toFixed(1) + 's"/>';
      });
      const wrap = document.createElement("div");
      wrap.className = "mcx"; wrap.setAttribute("aria-hidden", "true");
      wrap.innerHTML = '<svg viewBox="0 0 1600 1000" preserveAspectRatio="none">' + tr + pk + nd + "</svg>";
      shell.insertBefore(wrap, shell.firstChild);
    }

    // More menu: two switches, wired through hidden buttons like the menu's other rows
    const menu = document.getElementById("tbMenu");
    if (menu && !document.getElementById("minimalBtn")) {
      for (const [id, k, label] of [["minimalBtn", MK, "Minimal look"], ["circuitsBtn", CK, "Circuit lines"]]) {
        const hb = document.createElement("button");
        hb.type = "button"; hb.id = id; hb.hidden = true;
        hb.onclick = () => { put(k, !get(k)); apply(); };
        document.body.appendChild(hb);
        const row = document.createElement("button");
        row.type = "button"; row.setAttribute("role", "menuitem"); row.dataset.k = id;
        const st = document.createElement("span"); st.className = "st";
        row.append(label, st);
        menu.appendChild(row);
      }
    }
    apply();
  })();
