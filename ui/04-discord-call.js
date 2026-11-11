  /* ---------- Discord call ---------- */
  let dcS = null;
  const MIC_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M4 4l16 16"/></svg>';
  const DEAF_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 15v-3a8 8 0 0 1 16 0v3"/><path d="M4 4l16 16"/></svg>';
  const DC_MSG = {
    off: "Off", nosetup: "", connecting: "Connecting…", nodiscord: "Waiting for the Discord app to open…",
    auth: "Signing in…", approve: "Check Discord: click Authorize in its pop-up.", ok: "Connected"
  };
  function renderDc(st) {
    if (st) dcS = st;
    renderPins();
    if (dcVolFor && !(dcS && dcS.channel && dcS.channel.members.some(m => m.id === dcVolFor))) dcVolClose();
    const s = dcS || { status: "nosetup" };
    if (document.activeElement !== $("dcId") && s.clientId) $("dcId").value = s.clientId;
    $("dcSecretIn").placeholder = s.configured ? "Saved. Paste a new one to change it" : "Paste your client secret";
    const typed = $("dcSecretIn").value.trim().length;
    $("dcLen").textContent = typed ? `${typed} characters typed (Discord secrets have 32)` : s.configured ? `Saved secret: ${s.secretLen} characters (Discord secrets have 32)` : "";
    $("dcOff").hidden = !s.configured || s.status === "off";
    $("dcStatus").textContent = s.status === "error" ? "Couldn't connect: " + (s.err || "unknown error") : (DC_MSG[s.status] || "");
    $("dcStatus").classList.toggle("bad", s.status === "error");
    const ch = s.status === "ok" && s.channel;
    $("hmDc").hidden = !ch;
    $("hmDcEmpty").hidden = !!ch;
    const setup = !s.configured || s.status === "off" || s.status === "error";
    $("hmDcEmptyT").textContent = setup ? "Discord not connected" : s.status === "nodiscord" ? "Waiting for Discord" : "Not in a call";
    $("hmDcEmptyS").textContent = setup ? "Connect it in Settings → Discord." : s.status === "nodiscord" ? "Open the Discord app and it connects automatically." : "Join a channel in Discord and it shows up here.";
    if (!ch) return;
    $("hmDcName").textContent = ch.name;
    $("hmDcGuild").textContent = ch.guild || "";
    dcSince = ch.since || Date.now(); dcTimer();
    $("hmDcPin").setAttribute("aria-pressed", dcPins.some(p => p.id === ch.id));
    const vs = s.vs || {};
    $("hmDcMute").classList.toggle("on", !!vs.mute); $("hmDcMute").setAttribute("aria-pressed", !!vs.mute);
    $("hmDcDeaf").classList.toggle("on", !!vs.deaf); $("hmDcDeaf").setAttribute("aria-pressed", !!vs.deaf);
    const ppl = $("hmDcPeople"); ppl.replaceChildren();
    const list = ch.members.slice().sort((a, b) => (b.me - a.me) || a.name.localeCompare(b.name));
    const MAX = 10, shown = list.length > MAX ? MAX - 1 : MAX;
    list.slice(0, shown).forEach(m => {
      const p = mk("div", "dcp" + (m.speaking ? " talk" : "") + (m.me ? " me" : ""));
      const av = mk("div", "dcp-av"), im = mk("img"); im.alt = ""; im.onerror = () => im.removeAttribute("src"); if (m.avatar) im.src = m.avatar; im.referrerPolicy = "no-referrer"; av.append(im);
      if (m.deaf || m.muted) { const b = mk("span", "dcp-st"); b.innerHTML = m.deaf ? DEAF_OFF : MIC_OFF; av.append(b); }
      if (!m.me && m.vol !== 100) av.append(mk("span", "dcp-vol", m.vol + "%"));
      if (!m.me && m.localMute) { const b = mk("span", "dcp-lm"); b.title = "Muted for you"; b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M16 9l5 6M21 9l-5 6"/></svg>'; av.append(b); }
      p.append(av, mk("div", "dcp-n", m.name)); p.title = m.name;
      if (!m.me) { p.tabIndex = 0; p.setAttribute("role", "button"); p.setAttribute("aria-label", "Volume for " + m.name); p.onclick = () => dcVolOpen(m); p.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); dcVolOpen(m); } }; }
      ppl.append(p);
    });
    if (list.length > MAX) { const p = mk("div", "dcp"); p.append(mk("div", "dcp-more", "+" + (list.length - shown)), mk("div", "dcp-n", "more")); ppl.append(p); }
  }
  D.onDc(renderDc);
  D.dcGet().then(renderDc).catch(() => {});
  $("dcForm").addEventListener("submit", e => {
    e.preventDefault();
    const id = $("dcId").value.trim(), secret = $("dcSecretIn").value.trim();
    const bad = t => { $("dcStatus").textContent = t; $("dcStatus").classList.add("bad"); };
    if (!/^\d{15,22}$/.test(id)) return bad("That Client ID doesn't look right. It's a long number.");
    if (!secret && !(dcS && dcS.configured)) return bad("Paste your Client Secret too.");
    $("dcSecretIn").value = "";
    D.dcSave({ clientId: id, clientSecret: secret }).then(renderDc);
  });
  $("dcOff").onclick = () => D.dcOff().then(renderDc);
  $("dcShow").onclick = () => { const i = $("dcSecretIn"), show = i.type === "password"; i.type = show ? "text" : "password"; $("dcShow").textContent = show ? "Hide" : "Show"; };
  $("dcSecretIn").addEventListener("input", () => renderDc());
  $("hmDcMute").onclick = () => D.dcVoice("mute").then(renderDc);
  $("hmDcDeaf").onclick = () => D.dcVoice("deaf").then(renderDc);

  /* Discord panel: browse voice channels and change mic/audio settings */
  let dcPopOpen = false, dcPopView = "channels", dcGuildSel = store.get("dc.guild") || "", dcAudio = null, dcAudT = null, dcSideVolFor = null, dcSideVolT = null;
  const dcOk = () => !!(dcS && dcS.status === "ok");
  const VOICE_IC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>';
  function dcFab() { $("dcBtn").hidden = !(dcS && dcS.configured && dcS.status !== "off"); }
  async function dcLoadGuilds() {
    const box = $("dcGuilds"); box.replaceChildren();
    if (!dcOk()) { $("dcChans").replaceChildren(mk("p", "bell-empty", "Discord isn't connected yet.")); return; }
    const r = await D.dcGuilds().catch(() => null);
    // only the servers listed in your personal.json (all of them if none are listed)
    const DC_ONLY = (D.personal && D.personal.dcServers) || [];
    const norm = t => String(t || "").toLowerCase().replace(/\s+/g, "");
    const gs = (r && r.guilds || []).filter(g => !DC_ONLY.length || DC_ONLY.some(t => norm(g.name) === norm(t) || norm(g.name).includes(norm(t))))
      .sort((a, b) => DC_ONLY.findIndex(t => norm(a.name).includes(norm(t))) - DC_ONLY.findIndex(t => norm(b.name).includes(norm(t))));
    if (!gs.length) { $("dcChans").replaceChildren(mk("p", "bell-empty", r && r.guilds && r.guilds.length ? "Couldn't find your servers." : "Couldn't load your servers.")); return; }
    if (!gs.some(g => g.id === dcGuildSel)) dcGuildSel = (dcS.channel && dcS.channel.guildId) || gs[0].id;
    gs.forEach(g => {
      const b = mk("button", "dcg"); b.type = "button"; b.title = g.name; b.setAttribute("aria-label", g.name); b.setAttribute("aria-pressed", g.id === dcGuildSel);
      if (g.icon) { const im = mk("img"); im.alt = ""; im.referrerPolicy = "no-referrer"; im.src = g.icon; im.onerror = () => { im.remove(); b.textContent = g.name.split(/\s+/).map(w => w[0]).join("").slice(0, 3); }; b.append(im); }
      else b.textContent = g.name.split(/\s+/).map(w => w[0]).join("").slice(0, 3);
      b.onclick = () => { dcGuildSel = g.id; store.set("dc.guild", g.id); box.querySelectorAll(".dcg").forEach(x => x.setAttribute("aria-pressed", x === b)); dcLoadChans(); };
      box.append(b);
    });
    dcLoadChans();
  }
  async function dcLoadChans() {
    const box = $("dcChans");
    if (!box.children.length) box.replaceChildren(mk("p", "bell-empty", "Loading channels…"));
    const r = await D.dcChannels(dcGuildSel).catch(() => null);
    if (!dcPopOpen) return;
    box.replaceChildren();
    const cs = r && r.channels || [];
    if (!cs.length) { box.append(mk("p", "bell-empty", r && r.ok ? "No voice channels you can see here." : "Couldn't load channels.")); return; }
    cs.forEach(c => {
      const here = r.here === c.id;
      const row = mk("button", "dcc-row" + (here ? " here" : "")); row.type = "button";
      row.innerHTML = VOICE_IC; row.append(mk("span", "nm", c.name), mk("span", "go", here ? "You're here" : c.members.length ? c.members.length + " in" : "Join"));
      row.onclick = () => { if (here) return; D.dcJoin(c.id).then(x => { toast(x.ok ? "Joining " + c.name : "Couldn't join: " + x.err); setTimeout(() => dcPopOpen && dcLoadChans(), 1500); }); };
      box.append(row);
      if (c.members.length) {
        const ppl = mk("div", "dcc-ppl");
        const people = here && dcS && dcS.channel && dcS.channel.id === c.id ? dcS.channel.members : c.members;
        people.filter(m => !m.me).slice(0, 12).forEach(m => {
          const sp = mk(here && m.id ? "button" : "span", here && m.id ? "dcc-person" : "");
          if (sp.tagName === "BUTTON") {
            sp.type = "button"; sp.classList.toggle("is-muted", !!m.localMute); sp.title = (m.localMute ? "Left-click to unmute for you" : "Left-click to mute for you") + "; right-click for volume"; sp.setAttribute("aria-label", (m.localMute ? "Left-click to unmute " : "Left-click to mute ") + m.name + " for you; right-click for volume");
            sp.onclick = () => dcSideVolToggleMute(m.id, m.name);
            sp.oncontextmenu = e => { e.preventDefault(); dcSideVolOpen(m); };
            sp.onkeydown = e => { if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) { e.preventDefault(); dcSideVolOpen(m); } };
          }
          const im = mk("img"); im.alt = ""; im.referrerPolicy = "no-referrer"; if (m.avatar) im.src = m.avatar;
          sp.append(im, m.name); ppl.append(sp);
        });
        box.append(ppl);
      }
    });
  }
  function dcSideVolRender(m) {
    if (!m) return dcSideVolClose();
    dcSideVolFor = m.id;
    const box = $("dcSideVol"), avatar = $("dcSideVolAvatar"), slider = $("dcSideVolIn");
    box.hidden = dcPopView !== "channels";
    avatar.src = m.avatar || ""; avatar.onerror = () => avatar.removeAttribute("src");
    $("dcSideVolName").textContent = m.name;
    if (document.activeElement !== slider) slider.value = Math.max(0, Math.min(200, Number.isFinite(Number(m.vol)) ? Number(m.vol) : 100));
    $("dcSideVolOut").textContent = slider.value + "%";
    $("dcSideVolMute").classList.toggle("on", !!m.localMute);
    $("dcSideVolMute").setAttribute("aria-pressed", !!m.localMute);
    $("dcSideVolMute").textContent = m.localMute ? "Muted for me" : "Mute for me";
  }
  function dcSideVolOpen(m) { dcSideVolRender(m); $("dcSideVolIn").focus(); }
  function dcSideVolClose() { dcSideVolFor = null; $("dcSideVol").hidden = true; }
  $("dcSideVolClose").onclick = dcSideVolClose;
  function dcSideVolToggleMute(id, name) {
    const m = dcS && dcS.channel && dcS.channel.members.find(x => x.id === id);
    if (!m) return;
    D.dcUserMute(id, !m.localMute).then(st => {
      renderDc(st);
      if (st && st.action && !st.action.ok) { toast("Couldn't change " + (name || m.name) + ": " + st.action.error); return; }
      const next = st && st.channel && st.channel.members.find(x => x.id === id);
      if (next && dcSideVolFor === id) dcSideVolRender(next);
      if (dcPopOpen && dcPopView === "channels") dcLoadChans();
    }).catch(() => toast("Couldn't change " + (name || m.name) + "'s mute."));
  }
  $("dcSideVolMute").onclick = () => { if (dcSideVolFor) dcSideVolToggleMute(dcSideVolFor); };
  $("dcSideVolIn").addEventListener("input", () => {
    const value = +$("dcSideVolIn").value, id = dcSideVolFor;
    $("dcSideVolOut").textContent = value + "%";
    clearTimeout(dcSideVolT);
    dcSideVolT = setTimeout(() => { if (id) D.dcUserVol(id, value).then(st => { renderDc(st); const next = st && st.channel && st.channel.members.find(x => x.id === id); if (next) dcSideVolRender(next); }); }, 80);
  });
  $("dcSideVolIn").addEventListener("keydown", e => { if (e.key === "Escape") dcSideVolClose(); });
  function dcAudioRender() {
    const box = $("dcPopAudio"); box.replaceChildren();
    const a = dcAudio;
    if (!dcOk() || !a) { box.append(mk("p", "bell-empty", dcOk() ? "Loading…" : "Discord isn't connected yet.")); return; }
    if (a.error) box.append(mk("p", "bell-empty", "Discord said no: " + a.error));
    const devSel = (label, list, cur, key) => {
      const l = mk("label", "", label), sel = mk("select");
      list.forEach(d => { const o = mk("option", "", d.name); o.value = d.id; if (d.id === cur) o.selected = true; sel.append(o); });
      sel.onchange = () => dcAudioPush({ [key]: sel.value });
      l.append(sel); return l;
    };
    const vol = (label, v, max, key) => {
      const l = mk("label", "", label), row = mk("div", "vrow"), r = mk("input"), out = mk("span", "", v + "%");
      r.type = "range"; r.min = 0; r.max = max; r.value = v;
      r.oninput = () => { out.textContent = r.value + "%"; clearTimeout(dcAudT); dcAudT = setTimeout(() => dcAudioPush({ [key]: +r.value }, true), 120); };
      row.append(r, out); l.append(row); return l;
    };
    const tog = (label, on, key) => {
      const l = mk("div", "tg"); l.append(mk("span", "", label));
      const b = mk("button", "switch"); b.type = "button"; b.setAttribute("role", "switch"); b.setAttribute("aria-checked", on); b.setAttribute("aria-label", label);
      b.onclick = () => dcAudioPush({ [key]: !on });
      l.append(b); return l;
    };
    const mode = mk("div", "seg"); mode.setAttribute("role", "radiogroup");
    [["VOICE_ACTIVITY", "Voice activity"], ["PUSH_TO_TALK", "Push to talk"]].forEach(([k, t]) => {
      const b = mk("button", "", t); b.type = "button"; b.setAttribute("role", "radio"); b.setAttribute("aria-checked", a.mode === k);
      b.onclick = () => dcAudioPush({ mode: k }); mode.append(b);
    });
    box.append(
      devSel("Microphone", a.input.devices, a.input.device, "inputDevice"),
      vol("Mic volume", a.input.volume, 100, "inputVolume"),
      devSel("Headset / speakers", a.output.devices, a.output.device, "outputDevice"),
      vol("Output volume", a.output.volume, 200, "outputVolume"),
      mode,
      tog("Noise suppression", a.noise, "noise"),
      tog("Echo cancellation", a.echo, "echo"),
      tog("Automatic gain control", a.agc, "agc"));
  }
  async function dcAudioLoad() { dcAudio = await D.dcAudioGet().catch(() => null); if (dcPopOpen && dcPopView === "audio") dcAudioRender(); }
  async function dcAudioPush(patch, quiet) {
    const r = await D.dcAudioSet(patch).catch(() => null);
    if (r && !r.error) dcAudio = r; else if (r && r.error) dcAudio = Object.assign({}, dcAudio, { error: r.error });
    if (!quiet || (r && r.error)) dcAudioRender();
  }
  function dcPopView_(v) {
    dcPopView = v;
    document.querySelectorAll("#dcPopSeg button").forEach(b => b.setAttribute("aria-checked", b.dataset.v === v));
    $("dcPopChannels").hidden = v !== "channels"; $("dcPopAudio").hidden = v !== "audio";
    if (v !== "channels") dcSideVolClose();
    else if (dcSideVolFor) { const member = dcS && dcS.channel && dcS.channel.members.find(x => x.id === dcSideVolFor); if (member) dcSideVolRender(member); else dcSideVolClose(); }
    if (v === "channels") { dcLoadGuilds(); dcAudioLoad(); } else { dcAudioRender(); dcAudioLoad(); }
  }
  function dcPopShow(open) {
    dcPopOpen = open;
    $("dcPop").hidden = !open; $("dcBtn").setAttribute("aria-expanded", open);
    if (open) dcPopView_(dcPopView); else dcSideVolClose();
  }
  document.querySelectorAll("#dcPopSeg button").forEach(b => b.onclick = () => dcPopView_(b.dataset.v));
  $("dcBtn").onclick = e => { e.stopPropagation(); dcPopShow(!dcPopOpen); };
  document.addEventListener("mousedown", e => { if (dcPopOpen && !$("dcPop").contains(e.target) && !$("dcBtn").contains(e.target)) dcPopShow(false); });
  document.addEventListener("keydown", e => { if (dcPopOpen && e.key === "Escape") dcPopShow(false); });
  D.onDc(() => { dcFab(); if (dcSideVolFor) { const member = dcS && dcS.channel && dcS.channel.members.find(x => x.id === dcSideVolFor); if (member) dcSideVolRender(member); else dcSideVolClose(); } if (dcPopOpen && dcPopView === "channels") { clearTimeout(dcLoadChans.t); dcLoadChans.t = setTimeout(dcLoadChans, 800); } });
  D.dcGet().then(() => dcFab()).catch(() => {});
  // Discord status switch
  let dcPres = true;
  const renderDcPres = () => $("setDcPres").setAttribute("aria-checked", dcPres);
  D.dcPresence().then(v => { dcPres = v !== false; renderDcPres(); }).catch(() => {});
  $("setDcPres").onclick = () => D.dcPresence(!dcPres).then(v => { dcPres = v; renderDcPres(); });
  // Voice overlay settings
  let voC = null;
  function renderVo() {
    if (!voC) return;
    $("setVo").setAttribute("aria-checked", !!voC.on); $("setVoTalk").setAttribute("aria-checked", !!voC.onlyTalking);
    $("voCorner").value = voC.corner;
    if (voC.displays) { const sel = $("voDisplay"); sel.replaceChildren(); voC.displays.forEach(d => { const o = mk("option", "", d.name); o.value = d.id; sel.append(o); }); const prim = voC.displays.find(d => /\(main\)/.test(d.name)); sel.value = voC.displays.some(d => d.id === String(voC.display)) ? String(voC.display) : (prim ? prim.id : ""); }
    $("voOpts").hidden = !voC.on;
  }
  const voSet = patch => D.voSet(patch).then(v => { voC = Object.assign({}, voC, v); renderVo(); });
  D.voGet().then(v => { voC = v; renderVo(); }).catch(() => {});
  $("setVo").onclick = () => voSet({ on: !(voC && voC.on) });
  $("setVoTalk").onclick = () => voSet({ onlyTalking: !(voC && voC.onlyTalking) });
  $("voCorner").onchange = () => voSet({ corner: $("voCorner").value });
  $("voDisplay").onchange = () => voSet({ display: $("voDisplay").value });
  let mapW = true;
  D.mapWatch().then(v => { mapW = v !== false; $("setMapWatch").setAttribute("aria-checked", mapW); }).catch(() => {});
  $("setMapWatch").onclick = () => D.mapWatch(!mapW).then(v => { mapW = v; $("setMapWatch").setAttribute("aria-checked", mapW); });

