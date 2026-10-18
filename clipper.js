/* Sothis clips: records the last moments of your game on your graphics card and saves them when you press the clip key.
   - video: ffmpeg's desktop grabber (ddagrab) + the GPU's H.264 encoder, written in 2-second pieces that are reused (a rolling buffer)
   - sound: recorded by the Sothis window (system sound, and your mic if you want), kept in memory and handed over when a clip is saved
   - key overlay: your key presses and mouse clicks (from input-hook.ps1) drawn into the saved clip
   Nothing is kept except the clips you save; the rolling pieces are overwritten as it goes. */
const path = require("path"), fs = require("fs"), { spawn, execFile } = require("child_process");

module.exports = function makeClipper(ctx) {
  const { app, screen, DATA_DIR, log, getSettings, clipsDir, VID_RE, currentGame, onState, requestAudio, setAudio, notify, gameRect } = ctx;
  const FF_DIR = path.join(DATA_DIR, "ffmpeg");
  const BUF = path.join(DATA_DIR, "clipbuf");
  const SEG = 2, WRAP = 70;   // 2 s pieces, 140 s kept at most
  const S = () => getSettings().clips || {};
  const cfg = () => Object.assign({ on: true, len: 30, key: "F8", overlay: true, mic: false, fps: 60, monitor: "auto", sysVol: 100, micVol: 100, sysMute: false, micMute: false, window: true, audioOffset: 0, noise: "strong" }, S());
  // the mic is recorded whenever it's switched on (even muted), so a saved clip can still turn it up later in the editor
  const audioCfg = () => { const c = cfg(); return { on: true, mic: !!c.mic }; };

  let st = { phase: "off", msg: "", progress: 0 };
  const setSt = o => { st = Object.assign({}, st, o); try { onState(st); } catch {} };

  /* ---- ffmpeg: our own copy (a free build from github.com/BtbN/FFmpeg-Builds), downloaded once ---- */
  const ffExe = () => { const f = path.join(FF_DIR, "bin", "ffmpeg.exe"); return fs.existsSync(f) ? f : ""; };
  let dlBusy = null;
  function ffEnsure() {
    if (ffExe()) return Promise.resolve(true);
    if (dlBusy) return dlBusy;
    dlBusy = (async () => {
      const { net } = require("electron");
      const names = ["ffmpeg-master-latest-win64-gpl-shared.zip", "ffmpeg-n8.1-latest-win64-gpl-shared-8.1.zip", "ffmpeg-n9.0-latest-win64-gpl-shared-9.0.zip"];
      const zip = path.join(app.getPath("temp"), "sothis-ffmpeg.zip");
      for (const n of names) {
        try {
          setSt({ phase: "setup", msg: "Downloading the recorder…", progress: 0 });
          const r = await net.fetch("https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/" + n);
          if (!r.ok || !r.body) continue;
          const total = +r.headers.get("content-length") || 0, out = fs.createWriteStream(zip), rd = r.body.getReader();
          let got = 0, lastPct = -1;
          for (;;) {
            const { done, value } = await rd.read(); if (done) break;
            got += value.length; if (!out.write(Buffer.from(value))) await new Promise(res => out.once("drain", res));
            const pct = total ? Math.floor(got / total * 100) : 0; if (pct !== lastPct) { lastPct = pct; setSt({ progress: pct }); }
          }
          await new Promise(res => out.end(res));
          if (got < 20e6) continue;
          setSt({ msg: "Setting up the recorder…" });
          const tmp = path.join(app.getPath("temp"), "sothis-ffmpeg");
          try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
          fs.mkdirSync(tmp, { recursive: true });
          const ok = await new Promise(res => execFile("tar", ["-xf", zip, "-C", tmp], { windowsHide: true, timeout: 300000 }, e => res(!e)));
          if (!ok) continue;
          const top = fs.readdirSync(tmp).map(d => path.join(tmp, d)).find(d => fs.existsSync(path.join(d, "bin", "ffmpeg.exe")));
          if (!top) continue;
          try { fs.rmSync(FF_DIR, { recursive: true, force: true }); } catch {}
          fs.mkdirSync(FF_DIR, { recursive: true });
          fs.cpSync(path.join(top, "bin"), path.join(FF_DIR, "bin"), { recursive: true });
          try { fs.rmSync(tmp, { recursive: true, force: true }); fs.unlinkSync(zip); } catch {}
          if (ffExe()) { log("clips: recorder ready (" + n + ")"); setSt({ phase: "off", msg: "", progress: 100 }); return true; }
        } catch (e) { log("clips: recorder download failed: " + (e && e.message)); }
      }
      setSt({ phase: "error", msg: "Couldn't download the recorder. Check your internet and try again." });
      return false;
    })().finally(() => { dlBusy = null; });
    return dlBusy;
  }

  /* ---- rolling buffer ---- */
  let ff = null, encIdx = 0, startedAt = 0, segs = [], wallOff = null, listPos = 0, listTimer = null, want = false, vidSize = null;
  const ENC = [
    { name: "AMD", v: ["-c:v", "h264_amf", "-usage", "transcoding", "-quality", "speed", "-rc", "cqp", "-qp_i", "21", "-qp_p", "23", "-qp_b", "25"] },
    { name: "NVIDIA", v: ["-c:v", "h264_nvenc", "-preset", "p3", "-rc", "constqp", "-qp", "23"] },
    { name: "Intel", hw: "qsv", v: ["-c:v", "h264_qsv", "-global_quality", "23"] },
    { name: "CPU", soft: true, v: ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-pix_fmt", "yuv420p"] }
  ];
  function monitorIdx() {
    const c = cfg(), all = screen.getAllDisplays();
    if (c.monitor !== "auto" && all[+c.monitor]) return +c.monitor;
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const i = all.findIndex(x => x.id === d.id);
    return i >= 0 ? i : 0;
  }
  function readList() {
    const f = path.join(BUF, "list.csv");
    let txt = ""; try { const fd = fs.openSync(f, "r"), size = fs.fstatSync(fd).size; if (size > listPos) { const b = Buffer.alloc(size - listPos); fs.readSync(fd, b, 0, b.length, listPos); txt = b.toString("utf8"); listPos = size; } fs.closeSync(fd); } catch { return; }
    if (!txt) return;
    const now = Date.now();
    for (const line of txt.split(/\r?\n/)) {
      const m = line.split(","); if (m.length < 3) continue;
      const file = m[0].trim(), a = +m[1], b = +m[2]; if (!file || !isFinite(b)) continue;
      segs = segs.filter(x => x.file !== file).concat([{ file, a, b, at: now }]).slice(-WRAP + 2);
      const off = now - b * 1000;   // wall clock of stream time 0, from the moment each piece is finished (smallest = least delay)
      if (wallOff == null || off < wallOff) wallOff = off;
    }
  }
  function start() {
    want = true;
    if (ff || process.platform !== "win32" || !cfg().on) return;
    if (!ffExe()) { ffEnsure().then(ok => { if (ok && want) start(); }); return; }
    try { fs.rmSync(BUF, { recursive: true, force: true }); } catch {}
    fs.mkdirSync(BUF, { recursive: true });
    segs = []; wallOff = null; listPos = 0;
    const c = cfg(), idx = monitorIdx(), d = screen.getAllDisplays()[idx] || screen.getPrimaryDisplay();
    vidSize = { w: Math.round(d.size.width * d.scaleFactor), h: Math.round(d.size.height * d.scaleFactor) };
    const fps = c.fps === 30 ? 30 : 60, enc = ENC[Math.min(encIdx, ENC.length - 1)];
    const grab = `ddagrab=output_idx=${idx}:framerate=${fps}:draw_mouse=1`;
    const vf = enc.soft ? ["-vf", "hwdownload,format=bgra" + (vidSize.h > 1080 ? ",scale=-2:1080" : "")] : enc.hw === "qsv" ? ["-vf", "hwmap=derive_device=qsv,format=qsv"] : [];
    const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-f", "lavfi", "-i", grab, ...vf, ...enc.v, "-g", String(fps * SEG), "-keyint_min", String(fps * SEG), "-bf", "0",
      "-f", "segment", "-segment_time", String(SEG), "-segment_format", "mpegts", "-segment_list", path.join(BUF, "list.csv"), "-segment_list_type", "csv",
      "-segment_wrap", String(WRAP), "-reset_timestamps", "0", path.join(BUF, "seg%03d.ts")];
    let err = "";
    startedAt = Date.now();
    ff = spawn(ffExe(), args, { windowsHide: true, cwd: BUF });
    ff.stderr.on("data", d => { err = (err + d).slice(-2000); });
    ff.on("error", e => { err += String(e && e.message); });
    ff.on("exit", code => {
      const quick = Date.now() - startedAt < 8000;
      ff = null; clearInterval(listTimer); listTimer = null;
      if (!want) { setSt({ phase: "off", msg: "" }); return; }
      log("clips: recorder stopped (" + code + "): " + err.split("\n").filter(Boolean).slice(-2).join(" | "));
      if (quick && encIdx < ENC.length - 1) { encIdx++; log("clips: trying " + ENC[encIdx].name + " encoding"); setTimeout(start, 500); return; }
      setSt({ phase: "error", msg: "The recorder stopped. " + (quick ? "Your graphics card's encoder didn't start." : "Trying again…") });
      if (!quick) setTimeout(start, 3000);
    });
    listTimer = setInterval(readList, 500);
    setAudio(audioCfg());
    hookStart();
    const me = ff;
    setTimeout(() => { if (ff && ff === me) { setSt({ phase: "rec", msg: `Recording the last ${c.len} s (${enc.name})` }); log("clips: recording with " + enc.name + " on monitor " + (idx + 1)); } }, 3000);
  }
  function stop() {
    want = false;
    setAudio({ on: false });
    if (ff) { try { ff.kill(); } catch {} }
    setSt({ phase: "off", msg: "" });
  }

  /* ---- keyboard and mouse (clip key + overlay) ---- */
  let hook = null, inputs = [], hookOk = false;
  const VK = { 8: "Back", 9: "Tab", 13: "Enter", 16: "Shift", 17: "Ctrl", 18: "Alt", 20: "Caps", 27: "Esc", 32: "Space", 37: "←", 38: "↑", 39: "→", 40: "↓", 160: "Shift", 161: "Shift", 162: "Ctrl", 163: "Ctrl", 164: "Alt", 165: "Alt", 192: "`", 189: "-", 187: "=", 219: "[", 221: "]", 186: ";", 222: "'", 188: ",", 190: ".", 191: "/" };
  const vkName = vk => VK[vk] || (vk >= 48 && vk <= 57 ? String(vk - 48) : vk >= 65 && vk <= 90 ? String.fromCharCode(vk) : vk >= 112 && vk <= 123 ? "F" + (vk - 111) : vk >= 96 && vk <= 105 ? "Num" + (vk - 96) : "");
  const keyMatch = (ev, key) => key === "Mouse4" ? ev.k === "X1" : key === "Mouse5" ? ev.k === "X2" : ev.k === key;
  function hookStart() {
    if (hook || process.platform !== "win32") return;
    const ps = path.join(__dirname, "input-hook.ps1");
    hook = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", ps], { windowsHide: true });
    let buf = "";
    hook.stdout.on("data", d => {
      buf += d; const lines = buf.split(/\r?\n/); buf = lines.pop();
      for (const l of lines) {
        const [t, dn, v] = l.trim().split("|");
        if (t === "READY") { hookOk = dn === "1"; log("clips: key watcher " + (hookOk ? "on" : "couldn't start")); continue; }
        const k = t === "K" ? vkName(+v) : t === "M" ? v : t === "W" ? "Wheel" : "";
        if (!k) continue;
        const ev = { t: Date.now(), k, d: dn === "1" };
        inputs.push(ev); if (inputs.length > 6000) inputs = inputs.slice(-4000);
        if (ev.d && keyMatch(ev, cfg().key)) save().catch(() => {});
      }
    });
    hook.on("error", e => { log("clips: key watcher failed: " + (e && e.message)); });
    hook.on("exit", () => { hook = null; hookOk = false; if (want) setTimeout(hookStart, 5000); });
  }
  const hookActive = () => !!(hook && hookOk);

  /* ---- the key overlay: an .ass subtitle file drawn into the clip ---- */
  function overlayAss(t0, len, W, H) {
    const u = Math.round(H * 0.034), gap = Math.round(u * 0.14), r = Math.round(u * 0.18);
    const pad = Math.round(H * 0.03), fs = Math.round(u * 0.42);
    // keyboard block (bottom right) + mouse
    const K = [["Q", 0, 0], ["W", 1, 0], ["E", 2, 0], ["R", 3, 0], ["A", 0, 1], ["S", 1, 1], ["D", 2, 1], ["F", 3, 1], ["Shift", 0, 2, 1.6], ["Space", 1.75, 2, 2.25], ["Ctrl", 0, 3, 1.6], ["C", 1.75, 3], ["G", 2.85, 3]];
    const blockW = 4 * u + 3 * gap, mouseW = Math.round(u * 1.7);
    const x0 = W - pad - blockW - gap * 3 - mouseW, y0 = H - pad - (4 * u + 3 * gap);
    const pos = {};
    for (const [k, cx, cy, w = 1] of K) pos[k] = { x: Math.round(x0 + cx * (u + gap)), y: Math.round(y0 + cy * (u + gap)), w: Math.round(w * u + (w - 1) * gap), h: u };
    const mx = W - pad - mouseW, my = y0 + Math.round(u * 0.3);
    pos.L = { x: mx, y: my, w: Math.round(mouseW / 2 - gap / 2), h: Math.round(u * 1.4) };
    pos.R = { x: mx + Math.round(mouseW / 2 + gap / 2), y: my, w: Math.round(mouseW / 2 - gap / 2), h: Math.round(u * 1.4) };
    pos.Wheel = { x: mx + Math.round(mouseW / 2 - u * 0.15), y: my + Math.round(u * 0.25), w: Math.round(u * 0.3), h: Math.round(u * 0.6) };
    const T = s => { s = Math.max(0, s); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = (s % 60).toFixed(2).padStart(5, "0"); return `${h}:${String(m).padStart(2, "0")}:${sec}`; };
    const rect = (p, rr) => `m ${rr} 0 l ${p.w - rr} 0 b ${p.w} 0 ${p.w} 0 ${p.w} ${rr} l ${p.w} ${p.h - rr} b ${p.w} ${p.h} ${p.w} ${p.h} ${p.w - rr} ${p.h} l ${rr} ${p.h} b 0 ${p.h} 0 ${p.h} 0 ${p.h - rr} l 0 ${rr} b 0 0 0 0 ${rr} 0`;
    const lines = [];
    const box = (a, b, p, col, alpha, layer) => lines.push(`Dialogue: ${layer},${T(a)},${T(b)},Box,,0,0,0,,{\\an7\\pos(${p.x},${p.y})\\p1\\bord0\\shad0\\1c&H${col}&\\1a&H${alpha}&}${rect(p, r)}{\\p0}`);
    const label = (a, b, p, txt, alpha, layer) => lines.push(`Dialogue: ${layer},${T(a)},${T(b)},Key,,0,0,0,,{\\an5\\pos(${Math.round(p.x + p.w / 2)},${Math.round(p.y + p.h / 2)})\\fs${txt.length > 3 ? Math.round(fs * 0.8) : fs}\\1a&H${alpha}&}${txt}`);
    // resting keys for the whole clip
    for (const [k, p] of Object.entries(pos)) { box(0, len, p, "141414", "70", 0); if (k !== "Wheel" && k !== "L" && k !== "R") label(0, len, p, k, "40", 2); }
    // presses (red), from the key going down until it comes back up
    const evs = inputs.filter(e => e.t >= t0 - 30000 && e.t <= t0 + len * 1000 + 500);
    const open = {}, others = [];
    const show = (k, a, b) => {
      const s = Math.max(0, (a - t0) / 1000), e = Math.min(len, Math.max(s + 0.08, (b - t0) / 1000)); if (e <= 0 || s >= len) return;
      if (pos[k]) { box(s, e, pos[k], "4F3BFF", "10", 1); if (k !== "L" && k !== "R" && k !== "Wheel") label(s, e, pos[k], k, "00", 3); }
      else others.push({ k, s, e });
    };
    for (const e of evs) {
      if (e.k === "Wheel") { show("Wheel", e.t, e.t + 150); continue; }
      if (e.d) { if (!(e.k in open)) open[e.k] = e.t; }
      else if (e.k in open) { show(e.k, open[e.k], e.t); delete open[e.k]; }
    }
    for (const [k, a] of Object.entries(open)) show(k, a, t0 + len * 1000);
    // other keys: small chips over the keyboard block, newest on the right
    others.sort((a, b) => a.s - b.s);
    const chipW = Math.round(u * 1.05), cy = y0 - u - gap * 2;
    others.forEach((o, i) => {
      const slot = others.filter(x => x.s <= o.s && x.s + Math.max(0.6, x.e - x.s) > o.s).length - 1;
      const p = { x: Math.round(x0 + (slot % 5) * (chipW + gap)), y: cy, w: chipW, h: Math.round(u * 0.85) };
      const e = Math.max(o.e, o.s + 0.6);
      box(o.s, Math.min(len, e), p, "4F3BFF", "20", 1); label(o.s, Math.min(len, e), p, o.k, "00", 3);
    });
    return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${W}\nPlayResY: ${H}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Box,Arial,20,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1\nStyle: Key,Segoe UI,${fs},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${lines.join("\n")}\n`;
  }

  /* ---- save a clip ---- */
  let saving = false;
  const runFF = (args, cwd) => new Promise(res => { let e = ""; const p = spawn(ffExe(), args, { windowsHide: true, cwd }); p.stderr.on("data", d => { e = (e + d).slice(-3000); }); p.on("exit", c => res({ ok: c === 0, err: e })); p.on("error", x => res({ ok: false, err: String(x) })); });
  function wav(pcm, rate, ch) {
    const h = Buffer.alloc(44), n = pcm.length;
    h.write("RIFF", 0); h.writeUInt32LE(36 + n, 4); h.write("WAVE", 8); h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(ch, 22);
    h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * ch * 2, 28); h.writeUInt16LE(ch * 2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(n, 40);
    return Buffer.concat([h, pcm]);
  }
  // mic clean-up: "strong" is RNNoise (an AI model, noise-model.rnnn next to Sothis), "standard" is ffmpeg's own noise filter
  function nsFilter(mode, tmp) {
    if (mode === "off") return "";
    if (mode !== "standard") { try { fs.copyFileSync(path.join(__dirname, "noise-model.rnnn"), path.join(tmp, "nn.rnnn")); return "highpass=f=80,arnndn=m=nn.rnnn:mix=0.95,"; } catch {} }
    return "highpass=f=80,afftdn=nr=15:nf=-40:tn=1,";
  }
  async function save() {
    if (saving) return { ok: false, err: "Already saving a clip" };
    if (!ff || wallOff == null) return { ok: false, err: ffExe() ? (want ? "The recorder is still starting. Try again in a few seconds." : "Clips record while you're in a game. Start a game first, or turn on Record all the time in Settings.") : "The recorder isn't set up yet. Open Settings → Clips." };
    saving = true;
    const c = cfg(), len = Math.max(5, Math.min(120, +c.len || 30)), pressed = Date.now();
    try {
      // wait for the piece that's being written to finish so the clip goes right up to the key press
      for (let i = 0; i < 30; i++) { readList(); const last = segs[segs.length - 1]; if (last && wallOff + last.b * 1000 >= pressed - 200) break; await new Promise(r => setTimeout(r, 150)); }
      readList();
      const endS = (pressed - wallOff) / 1000, startS = endS - len;
      const use = segs.filter(x => x.b > startS - 0.1 && x.a < endS + 0.1).sort((a, b) => a.a - b.a);
      if (!use.length) return { ok: false, err: "Nothing recorded yet" };
      const tmp = path.join(DATA_DIR, "cliptmp"); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} fs.mkdirSync(tmp, { recursive: true });
      // stitch the pieces (MPEG-TS pieces join end to end)
      const ts = path.join(tmp, "v.ts"), out = fs.openSync(ts, "w");
      for (const s of use) { try { fs.writeSync(out, fs.readFileSync(path.join(BUF, s.file))); } catch {} }
      fs.closeSync(out);
      const clipStart = Math.max(startS, use[0].a), clipLen = Math.min(len, endS - clipStart), off = Math.max(0, clipStart - use[0].a);
      const wall0 = wallOff + clipStart * 1000;
      // sound for exactly that time
      let audio = null; try { audio = await requestAudio(wall0 + (+c.audioOffset || 0), clipLen); } catch {}
      // only the game's window: crop to it when the game isn't filling the whole screen
      let crop = "";
      if (c.window !== false && typeof gameRect === "function") {
        try {
          const g = await Promise.race([gameRect(), new Promise(r => setTimeout(() => r(null), 5000))]);
          const VW = (vidSize && vidSize.w) || 0, VH = (vidSize && vidSize.h) || 0;
          if (g && VW && g.mw === VW && g.mh === VH && g.w > 200 && g.h > 150 && (g.w < VW - 8 || g.h < VH - 8)) {
            const k = ENC[encIdx].soft && VH > 1080 ? 1080 / VH : 1;
            const ev = n => Math.max(2, Math.floor(n * k / 2) * 2);
            let x = Math.max(0, g.x - g.mx), y = Math.max(0, g.y - g.my), w = Math.min(g.w, VW - x), h = Math.min(g.h, VH - y);
            crop = `crop=${ev(w)}:${ev(h)}:${ev(x)}:${ev(y)},`;
          }
        } catch {}
      }
      let haveAudio = false, haveMic = false;
      if (audio && audio.pcm && (audio.pcm.byteLength || audio.pcm.length)) { fs.writeFileSync(path.join(tmp, "a.wav"), wav(Buffer.from(audio.pcm), audio.rate || 48000, audio.ch || 2)); haveAudio = true; }
      if (haveAudio && audio.mic && (audio.mic.byteLength || audio.mic.length)) { fs.writeFileSync(path.join(tmp, "m.wav"), wav(Buffer.from(audio.mic), audio.rate || 48000, 1)); haveMic = true; }
      const ns = haveMic ? nsFilter(c.noise, tmp) : "";
      // key overlay
      const W = (vidSize && vidSize.w) || 1920, H = (vidSize && vidSize.h) || 1080;
      const overlay = false; // key overlay removed
      if (overlay) fs.writeFileSync(path.join(tmp, "keys.ass"), overlayAss(wall0, clipLen, ENC[encIdx].soft && H > 1080 ? Math.round(W * 1080 / H) : W, ENC[encIdx].soft && H > 1080 ? 1080 : H));
      // where it goes: <clips>/<Game>/<Game N>.mp4
      const game = String(currentGame() || "").replace(/[<>:"/\\|?*]/g, "").trim();
      const dir = game ? path.join(clipsDir(), game) : clipsDir(); fs.mkdirSync(dir, { recursive: true });
      const base = game || "Clip";
      let count = 0; try { count = fs.readdirSync(dir).filter(n => VID_RE.test(n)).length; } catch {}
      let n = count + 1, file = path.join(dir, `${base} ${n}.mp4`); while (fs.existsSync(file)) file = path.join(dir, `${base} ${++n}.mp4`);
      const encs = [["-c:v", "h264_amf", "-quality", "quality", "-rc", "cqp", "-qp_i", "18", "-qp_p", "20"], ["-c:v", "h264_nvenc", "-preset", "p5", "-cq", "19"], ["-c:v", "h264_qsv", "-global_quality", "20"], ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18"]];
      let res = { ok: false, err: "" };
      // tracks: 1 = the mix you hear (what Discord and players play), 2 = game sound, 3 = your mic (cleaned up), so the editor can remix them
      const sv = c.sysMute ? 0 : (+c.sysVol || 0) / 100, mv = c.micMute ? 0 : (+c.micVol || 0) / 100;
      let fc = `[0:v]${crop}${overlay ? "subtitles=keys.ass," : ""}format=yuv420p[v]`;
      const amap = [];
      if (haveAudio && haveMic) {
        fc += `;[1:a]asplit=2[g1][g2];[g1]volume=${sv.toFixed(2)}[gv];[2:a]${ns}asplit=2[m1][m2];[m1]volume=${mv.toFixed(2)},pan=stereo|c0=c0|c1=c0[mv];[gv][mv]amix=inputs=2:normalize=0:duration=first[mix]`;
        amap.push("-map", "[mix]", "-map", "[g2]", "-map", "[m2]", "-metadata:s:a:0", "title=Mix", "-metadata:s:a:1", "title=Game", "-metadata:s:a:2", "title=Mic", "-disposition:a:0", "default", "-disposition:a:1", "0", "-disposition:a:2", "0");
      } else if (haveAudio) {
        fc += `;[1:a]asplit=2[g1][g2];[g1]volume=${sv.toFixed(2)}[mix]`;
        amap.push("-map", "[mix]", "-map", "[g2]", "-metadata:s:a:0", "title=Mix", "-metadata:s:a:1", "title=Game", "-disposition:a:0", "default", "-disposition:a:1", "0");
      }
      for (const e of encs) {
        const args = ["-hide_banner", "-y", "-ss", off.toFixed(3), "-i", "v.ts", ...(haveAudio ? ["-i", "a.wav"] : []), ...(haveMic ? ["-i", "m.wav"] : []), "-t", clipLen.toFixed(3),
          "-filter_complex", fc, "-map", "[v]", ...amap, ...e,
          ...(haveAudio ? ["-c:a", "aac", "-b:a", "192k"] : []), "-movflags", "+faststart", file];
        res = await runFF(args, tmp);
        if (res.ok) break;
        try { fs.unlinkSync(file); } catch {}
      }
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
      if (!res.ok) { log("clips: save failed: " + res.err.split("\n").filter(Boolean).slice(-2).join(" | ")); return { ok: false, err: "Couldn't save the clip" }; }
      log("clips: saved " + path.basename(file) + " (" + clipLen.toFixed(1) + " s" + (overlay ? ", keys" : "") + (haveAudio ? ", sound" : ", no sound") + ")");
      try { notify(path.basename(file, ".mp4"), file); } catch {}
      return { ok: true, name: path.basename(file), file };
    } finally { saving = false; }
  }

  return {
    start, stop, save, ffEnsure, ffExe,
    state: () => Object.assign({}, st, { ready: !!ffExe(), recording: !!ff, keys: hookActive(), cfg: cfg() }),
    keyName: () => cfg().key,
    hookActive, hookStart,
    _inject: evs => { inputs = evs; hookOk = true; hook = hook || { fake: true }; },
    applyAudio: () => { if (ff) setAudio(audioCfg()); },
    restart: () => { if (ff) { const was = want; stop(); setTimeout(() => { if (was) start(); }, 2000); } }
  };
};
