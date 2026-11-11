  /* ---------- Switch: your OBS Switch scene, projector style ---------- */
  // Shows the capture card directly (lowest delay). If OBS is holding the card, it uses OBS's Virtual Camera instead.
  let swUsed = null, swVolume = Math.max(0, Math.min(100, +(store.get("sw.vol") || 100))) / 100;
  let swStream = null, swOn = false, swSound = store.get("sw.sound") === "1", swStarting = false, swBarT = null, swFullOn = false;
  const swMsg = t => { $("swMsg").hidden = !t; $("swMsgT").textContent = t || ""; $("swObs").hidden = true; };
  $("swObs").onsubmit = async e => {
    e.preventDefault();
    const p = $("swObsPass").value.trim(); if (!p) return;
    try { await D.obsSetPass(p); } catch {}
    $("swObsPass").value = ""; swObsHeld = []; swStart();
  };
  const isObsCam = d => /obs/i.test(d.label);
  const isCard = d => /fifine|capture|cam link|elgato|hdmi|usb video|av\.?mmio|ezcap/i.test(d.label) && !isObsCam(d);
  // the capture card's sound shows up as its own "microphone"; cheap cards call it "Digital Audio Interface"
  const isCardAudio = d => /fifine|capture|cam link|elgato|hdmi|usb video|av\.?mmio|ezcap|digital audio interface|usb digital audio|ms2109|macrosilicon|live gamer|avermedia|game ?capture/i.test(d.label) && !isObsCam(d);
  const swIns = devs => devs.filter(d => d.kind === "audioinput" && d.deviceId !== "default" && d.deviceId !== "communications");
  function swPickMic(devs, used) {
    const ins = swIns(devs), saved = store.get("sw.aud") || "";
    if (saved) { const s = ins.find(d => d.deviceId === saved); if (s) return s; }
    if (used && isObsCam(used)) return null;   // OBS Virtual Camera has no sound of its own; pick a source to hear it here
    return (used && ins.find(d => d.groupId && d.groupId === used.groupId)) || ins.find(isCardAudio) || null;
  }
  function swAudList(devs) {
    const sel = $("swAud"), saved = store.get("sw.aud") || ""; sel.replaceChildren();
    const a = mk("option", "", "Sound: auto"); a.value = ""; sel.append(a);
    swIns(devs).forEach(d => { const o = mk("option", "", d.label || "Audio input"); o.value = d.deviceId; sel.append(o); });
    sel.value = swIns(devs).some(d => d.deviceId === saved) ? saved : "";
  }
  // turn the Switch's sound on or off (and pick it up again) without restarting the picture
  async function swAudioApply(devs, quiet) {
    const v = $("swVid"); if (!swStream) return;
    swStream.getAudioTracks().forEach(t => { t.stop(); swStream.removeTrack(t); });
    v.volume = swVolume;
    if (!swSound) { v.muted = true; return; }
    devs = devs || await swDevices();
    const mic = swPickMic(devs, swUsed);
    if (!mic) { v.muted = true; if (!quiet) toast(swUsed && isObsCam(swUsed) ? "OBS Virtual Camera has no sound. Pick your capture card under Sound" : "Couldn't find your capture card's sound. Pick it from the Sound list"); return; }
    try {
      const a = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: mic.deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false, latency: 0 } });
      if (!swStream) { a.getTracks().forEach(t => t.stop()); return; }
      a.getAudioTracks().forEach(t => swStream.addTrack(t));
      v.srcObject = swStream; v.muted = false; v.volume = swVolume; v.play().catch(() => {});
    } catch { v.muted = true; if (!quiet) toast("Couldn't open " + (mic.label || "that sound source")); }
  }
  let swSigT = null;
  function swSigWatch(on) {
    clearInterval(swSigT); swSigT = null; $("swNoSig").hidden = true;
    if (!on) return;
    const c = document.createElement("canvas"); c.width = 32; c.height = 18; const x = c.getContext("2d", { willReadFrequently: true });
    let dark = 0;
    swSigT = setInterval(() => {
      const v = $("swVid"); if (!v.videoWidth || !$("swMsg").hidden) { $("swNoSig").hidden = true; return; }
      try { x.drawImage(v, 0, 0, 32, 18); const d = x.getImageData(0, 0, 32, 18).data; let sum = 0; for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2]; dark = sum / (d.length / 4 * 3) < 4 ? dark + 1 : 0; } catch { dark = 0; }
      $("swNoSig").hidden = dark < 2;
    }, 1500);
  }
  function swStop() {
    swSigWatch(false);
    if (swStream) swStream.getTracks().forEach(t => t.stop());
    swStream = null; $("swVid").srcObject = null;
    try { D.presenceSwitch(false); } catch {}
    if (swObsHeld.length) setTimeout(swObsGiveBack, 400);   // hand the capture card back to OBS
  }
  /* OBS holding the capture card: borrow it through OBS's WebSocket (switch OBS's capture source off while the Switch tab
     shows it, then back on when you leave), so the Virtual Camera isn't needed */
  let swObsHeld = [];
  async function swObsCall(fn) {
    const sha = async t => btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))));
    return new Promise(res => {
      let ws, n = 0; const pend = {}, done = v => { try { ws.close(); } catch {} res(v); };
      const req = (t, d) => new Promise((ok, no) => { const id = "r" + (++n); pend[id] = { ok, no }; ws.send(JSON.stringify({ op: 6, d: { requestType: t, requestId: id, requestData: d || {} } })); setTimeout(() => { if (pend[id]) { delete pend[id]; no(new Error("timeout")); } }, 5000); });
      try { ws = new WebSocket("ws://127.0.0.1:4455"); } catch { return res(null); }
      const t = setTimeout(() => done(null), 8000);
      ws.onerror = () => { clearTimeout(t); done(null); };
      ws.onmessage = async ev => {
        const m = JSON.parse(ev.data);
        if (m.op === 0) {
          const d = { rpcVersion: 1, eventSubscriptions: 0 };
          if (m.d.authentication) { let p = ""; try { p = await D.obsPass(); } catch {} if (!p) { clearTimeout(t); return done(null); } d.authentication = await sha(await sha(p + m.d.authentication.salt) + m.d.authentication.challenge); }
          ws.send(JSON.stringify({ op: 1, d }));
        } else if (m.op === 2) { let v = null; try { v = await fn(req); } catch {} clearTimeout(t); done(v); }
        else if (m.op === 7) { const p = pend[m.d.requestId]; if (p) { delete pend[m.d.requestId]; m.d.requestStatus.result ? p.ok(m.d.responseData || {}) : p.no(new Error(m.d.requestStatus.comment || "no")); } }
      };
    });
  }
  async function swObsBorrow() {
    const names = await swObsCall(async req => {
      const out = [];
      const list = ((await req("GetInputList", { inputKind: "dshow_input" })).inputs || []);
      for (const i of list) {
        const st = (await req("GetInputSettings", { inputName: i.inputName })).inputSettings || {};
        if (st.active === false) continue;
        await req("PressInputPropertiesButton", { inputName: i.inputName, propertyName: "activate" });
        out.push(i.inputName);
      }
      return out;
    });
    if (names && names.length) swObsHeld = names;
    return names;
  }
  async function swObsGiveBack() {
    if (swStream || swStarting || (swOn && !swPopped) || !swObsHeld.length) return;
    const names = swObsHeld; swObsHeld = [];
    await swObsCall(async req => { for (const n of names) { const st = (await req("GetInputSettings", { inputName: n })).inputSettings || {}; if (st.active === false) await req("PressInputPropertiesButton", { inputName: n, propertyName: "activate" }); } return true; });
  }
  async function swDevices() {
    try { return (await navigator.mediaDevices.enumerateDevices()) || []; } catch { return []; }
  }
  async function swStart() {
    if (swStarting || !swOn) return;
    swStarting = true; swStop(); swMsg("Starting your Switch…");
    try {
      let devs = await swDevices();
      if (devs.some(d => d.kind === "videoinput" && !d.label)) {   // labels show up after the first permission
        try { (await navigator.mediaDevices.getUserMedia({ video: true })).getTracks().forEach(t => t.stop()); } catch {}
        devs = await swDevices();
      }
      const vids = devs.filter(d => d.kind === "videoinput");
      const sel = $("swSrc"); sel.replaceChildren();
      const auto = mk("option", "", "Auto (capture card, then OBS)"); auto.value = ""; sel.append(auto);
      vids.forEach(d => { const o = mk("option", "", d.label || "Camera"); o.value = d.deviceId; sel.append(o); });
      const saved = store.get("sw.src") || "";
      sel.value = vids.some(d => d.deviceId === saved) ? saved : "";
      const order = sel.value ? vids.filter(d => d.deviceId === sel.value) : [...vids.filter(isCard), ...vids.filter(isObsCam)];
      if (!order.length) { swMsg(vids.length ? "Pick your capture card or OBS Virtual Camera from the menu at the bottom." : "No capture card or OBS Virtual Camera found. Plug in your capture card, or start the Virtual Camera in OBS."); return; }
      let stream = null, used = null, busy = false;
      const open = d => navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: d.deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60 } } });
      for (const d of order) {
        try { stream = await open(d); used = d; break; }
        catch (e) {
          if (!(e && (e.name === "NotReadableError" || e.name === "TrackStartError"))) continue;
          busy = true;
          // OBS has the card: switch OBS's capture source off for now and take the card directly
          if (isCard(d) && !swObsHeld.length) {
            swMsg("Borrowing your capture card from OBS…");
            const got = await swObsBorrow();
            if (got && got.length) { for (let i = 0; i < 6 && !stream; i++) { await new Promise(r => setTimeout(r, 400)); try { stream = await open(d); used = d; } catch {} } if (stream) break; }
          }
        }
      }
      if (!stream) {
        swMsg(busy ? "OBS is using your capture card. To let Sothis borrow it, turn on OBS's remote control (Tools → WebSocket Server Settings → Enable WebSocket server), then paste its Server Password here." : "Couldn't open the video. Pick a different source from the menu at the bottom.");
        if (busy) $("swObs").hidden = false;
        return;
      }
      if (!swOn) { stream.getTracks().forEach(t => t.stop()); return; }
      swStream = stream; swUsed = used;
      try { D.presenceSwitch(true); } catch {}
      const v = $("swVid"); v.srcObject = stream; v.muted = true; v.volume = swVolume;
      v.play().catch(() => {});
      swMsg("");
      swSigWatch(true);
      swAudList(devs);
      await swAudioApply(devs);
    } finally { swStarting = false; }
  }
  let swPopped = false;
  function swActive(on) {
    if (on === swOn) return;
    swOn = on;
    if (on && !swPopped) swStart(); else if (!on) { swStop(); if (swFullOn) swFull(false); }   // let OBS have the card back when you leave
  }
  function swPopState(on) {
    swPopped = !!on;
    $("swBack").hidden = !swPopped;
    if (swPopped) { swStop(); if (swFullOn) swFull(false); swMsg("Your Switch is playing in its own window."); $("swBack").hidden = false; }
    else if (swOn) swStart();
  }
  D.onSwPop(swPopState);
  D.swPopped().then(on => { if (on) swPopState(true); }).catch(() => {});
  $("swPop").onclick = () => { swStop(); swPopState(true); D.swPopout(); };
  $("swBack").onclick = () => D.swPopin();
  function swFull(on) {
    swFullOn = on;
    document.body.classList.toggle("sw-full", on);
    D.fullscreen(on);
  }
  // Sharper upscaling: draw the video through the GPU (bicubic + contrast-adaptive sharpening)
  let swHd = store.get("sw.hd") !== "0";
  const swUp = window.SwUpscale ? window.SwUpscale.attach($("swVid"), $("swCan")) : null;
  const swHdRender = () => { $("swHd").setAttribute("aria-pressed", swHd && !!swUp); $("swHd").hidden = !swUp; if (swUp) swUp.setOn(swHd && !!swStream); };
  $("swHd").onclick = () => { swHd = !swHd; store.set("sw.hd", swHd ? "1" : "0"); swHdRender(); };
  $("swVid").addEventListener("playing", () => { swHdRender(); if (swUp) swUp.kick(); });
  $("swVid").addEventListener("emptied", () => swUp && swUp.setOn(false));
  $("swCan").ondblclick = () => swFull(!swFullOn);
  swHdRender();
  $("swSrc").onchange = () => { store.set("sw.src", $("swSrc").value); swStart(); };
  const swSndRender = () => {
    $("swSnd").setAttribute("aria-pressed", swSound); $("swSnd").title = swSound ? "Mute the Switch" : "Turn on the Switch's sound";
    $("swVolBox").classList.toggle("off", !swSound);
    $("swVol").value = Math.round(swVolume * 100); $("swVolN").textContent = Math.round(swVolume * 100);
    $("swVol").style.setProperty("--p", Math.round(swVolume * 100) + "%");
  };
  swSndRender();
  const swSoundSet = on => { swSound = on; store.set("sw.sound", on ? "1" : "0"); swSndRender(); swAudioApply(); };
  $("swSnd").onclick = () => swSoundSet(!swSound);
  $("swVol").addEventListener("input", () => {
    swVolume = +$("swVol").value / 100; store.set("sw.vol", String(Math.round(swVolume * 100)));
    $("swVid").volume = swVolume; swSndRender();
    if (!swSound && swVolume > 0) swSoundSet(true);   // moving the slider turns the sound on
  });
  $("swVolBox").addEventListener("wheel", e => { e.preventDefault(); $("swVol").value = Math.max(0, Math.min(100, +$("swVol").value + (e.deltaY < 0 ? 5 : -5))); $("swVol").dispatchEvent(new Event("input")); }, { passive: false });
  $("swAud").onchange = () => { store.set("sw.aud", $("swAud").value); if (!swSound) swSoundSet(true); else swAudioApply(); };
  $("swFull").onclick = () => swFull(!swFullOn);
  $("swVid").ondblclick = () => swFull(!swFullOn);
  D.onFull(on => { if (!on && swFullOn) { swFullOn = false; document.body.classList.remove("sw-full"); } });
  $("swStage").addEventListener("mousemove", () => { $("swStage").classList.add("show-bar"); clearTimeout(swBarT); swBarT = setTimeout(() => $("swStage").classList.remove("show-bar"), 2000); });
  document.addEventListener("keydown", e => { if (swFullOn && e.key === "Escape") swFull(false); else if (tab === "switch" && (e.key === "F11" || (e.key === "f" && !e.target.matches("input, textarea, select")))) { e.preventDefault(); swFull(!swFullOn); } });
  navigator.mediaDevices && navigator.mediaDevices.addEventListener("devicechange", () => { if (swOn && !swStream) swStart(); });

