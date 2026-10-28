/* Sothis clips: records the last moments of your game on your graphics card and saves them when you press the clip key.
   - video: ffmpeg's desktop grabber (ddagrab) + the GPU's H.264 encoder, written in 2-second pieces that are reused (a rolling buffer)
   - sound: recorded by the Sothis window (system sound, and your mic if you want), kept in memory and handed over when a clip is saved
   - key overlay: your key presses and mouse clicks (from input-hook.ps1) drawn into the saved clip
   Nothing is kept except the clips you save; the rolling pieces are overwritten as it goes. */
const path = require("path"), fs = require("fs"), { spawn, execFile } = require("child_process");

module.exports = function makeClipper(ctx) {
  const { app, screen, DATA_DIR, log, getSettings, clipsDir, VID_RE, currentGame, onState, requestAudio, setAudio, notify, gameRect, gameMonitor, featOn } = ctx;
  const FF_DIR = path.join(DATA_DIR, "ffmpeg");
  const BUF = path.join(DATA_DIR, "clipbuf");
  const SEG = 2, WRAP = 70;   // 2 s pieces, 140 s kept at most
  const S = () => getSettings().clips || {};
  const cfg = () => Object.assign({ quality: "high", on: true, len: 30, key: "F8", overlay: true, mic: false, fps: 60, monitor: "auto", sysVol: 100, micVol: 100, voiceVol: 100, sysMute: false, micMute: false, voiceMute: false, splitVoice: true, window: true, audioOffset: 0, noise: "strong" }, S());
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
  // each recorder run writes into its own folder; when Windows briefly takes the screen away (a game going full screen,
  // alt-tab, a resolution change) the recorder restarts right away and the earlier pieces are kept, so clips stay full length
  let run = 0, runDir = BUF, oldSegs = [], curIdx = -1;
  // recording quality, like Medal's: constant quality on the graphics card (lower number = sharper, bigger files)
  const QP = { standard: 23, high: 19, max: 16 };
  const qp = () => QP[cfg().quality] || QP.high;
  const ENC = [
    { name: "AMD", get v() { const q = qp(); return ["-c:v", "h264_amf", "-usage", "transcoding", "-quality", q <= 19 ? "balanced" : "speed", "-rc", "cqp", "-qp_i", String(q), "-qp_p", String(q + 2), "-qp_b", String(q + 4)]; } },
    { name: "NVIDIA", get v() { const q = qp(); return ["-c:v", "h264_nvenc", "-preset", q <= 19 ? "p5" : "p3", "-tune", "hq", "-rc", "constqp", "-qp", String(q)]; } },
    { name: "Intel", hw: "qsv", get v() { return ["-c:v", "h264_qsv", "-global_quality", String(qp())]; } },
    { name: "CPU", soft: true, get v() { return ["-c:v", "libx264", "-preset", qp() <= 19 ? "superfast" : "ultrafast", "-crf", String(qp() + 1), "-pix_fmt", "yuv420p"]; } }
  ];
  function monitorIdx() {
    const c = cfg(), all = screen.getAllDisplays();
    // while you play, the screen your game is on (so the clip is the game, whatever screen is picked in Settings)
    const g = typeof gameMonitor === "function" ? gameMonitor() : -1;
    if (g >= 0 && all[g]) return g;
    if (c.monitor !== "auto" && all[+c.monitor]) return +c.monitor;
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const i = all.findIndex(x => x.id === d.id);
    return i >= 0 ? i : 0;
  }
  let restartWanted = false, lossAt = [];
  // the game moved to another screen (or just started on one): record that screen instead
  function followGame() {
    if (!ff) return;
    const i = monitorIdx();
    if (i !== curIdx) { log("clips: following the game to screen " + (i + 1)); restartWanted = true; try { ff.kill(); } catch {} }
  }
  function readList() {
    const f = path.join(runDir, "list.csv");
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
  function start(keep) {
    want = true;
    if (ff || process.platform !== "win32" || !cfg().on || (typeof featOn === "function" && !featOn("clips"))) return;
    if (!ffExe()) { ffEnsure().then(ok => { if (ok && want) start(); }); return; }
    if (keep && wallOff != null && segs.length) {
      // keep the last run's pieces (by wall-clock time) for clips that reach back past the restart
      for (const x of segs) oldSegs.push({ path: path.join(runDir, x.file), wa: wallOff + x.a * 1000, wb: wallOff + x.b * 1000, run });
    } else { oldSegs = []; try { fs.rmSync(BUF, { recursive: true, force: true }); } catch {} }
    const now = Date.now();
    oldSegs = oldSegs.filter(x => x.wb > now - (WRAP * SEG + 20) * 1000);
    // drop folders of runs nothing points to any more
    try { const keepRuns = new Set(oldSegs.map(x => "r" + x.run)); for (const d of fs.readdirSync(BUF)) if (/^r\d+$/.test(d) && !keepRuns.has(d)) fs.rmSync(path.join(BUF, d), { recursive: true, force: true }); } catch {}
    run++; runDir = path.join(BUF, "r" + run);
    fs.mkdirSync(runDir, { recursive: true });
    segs = []; wallOff = null; listPos = 0;
    const c = cfg(), idx = monitorIdx(), d = screen.getAllDisplays()[idx] || screen.getPrimaryDisplay();
    curIdx = idx;
    vidSize = { w: Math.round(d.size.width * d.scaleFactor), h: Math.round(d.size.height * d.scaleFactor) };
    const fps = c.fps === 30 ? 30 : 60, enc = ENC[Math.min(encIdx, ENC.length - 1)];
    const grab = `ddagrab=output_idx=${idx}:framerate=${fps}:draw_mouse=1`;
    const vf = enc.soft ? ["-vf", "hwdownload,format=bgra" + (vidSize.h > 1080 ? ",scale=-2:1080" : "")] : enc.hw === "qsv" ? ["-vf", "hwmap=derive_device=qsv,format=qsv"] : [];
    const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-f", "lavfi", "-i", grab, ...vf, ...enc.v, "-g", String(fps * SEG), "-keyint_min", String(fps * SEG), "-bf", "0",
      "-f", "segment", "-segment_time", String(SEG), "-segment_format", "mpegts", "-segment_list", path.join(runDir, "list.csv"), "-segment_list_type", "csv",
      "-segment_wrap", String(WRAP), "-reset_timestamps", "0", path.join(runDir, "seg%03d.ts")];
    let err = "";
    startedAt = Date.now();
    ff = spawn(ffExe(), args, { windowsHide: true, cwd: runDir });
    ff.stderr.on("data", d => { err = (err + d).slice(-2000); });
    ff.on("error", e => { err += String(e && e.message); });
    ff.on("exit", code => {
      const quick = Date.now() - startedAt < 8000;
      ff = null; clearInterval(listTimer); listTimer = null;
      if (!want) { setSt({ phase: "off", msg: "" }); return; }
      log("clips: recorder stopped (" + code + "): " + err.split("\n").filter(Boolean).slice(-2).join(" | "));
      // Windows took the screen away for a moment (full screen switch, alt-tab, resolution change): not the encoder's fault,
      // so pick up again right away with the same encoder and keep what was recorded
      if (/887a0026|887a0027|ACCESS_LOST|AcquireNextFrame/i.test(err) || restartWanted) {
        restartWanted = false;
        const t = Date.now(); lossAt = lossAt.filter(x => t - x < 15000).concat(t);
        setTimeout(() => start(true), lossAt.length > 6 ? 3000 : 300);   // if it keeps happening, breathe a little between tries
        return;
      }
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
    // strong: the AI model at full strength, then a soft gate that quiets what's left between words (keys, fans), like Medal's noise suppression
    if (mode !== "standard") { try { fs.copyFileSync(path.join(__dirname, "noise-model.rnnn"), path.join(tmp, "nn.rnnn")); return "highpass=f=80,arnndn=m=nn.rnnn:mix=1,agate=threshold=0.012:ratio=4:attack=4:release=150:range=0.05,"; } catch {} }
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
      const all = oldSegs.map(x => ({ full: x.path, a: (x.wa - wallOff) / 1000, b: (x.wb - wallOff) / 1000, run: x.run }))
        .concat(segs.map(x => ({ full: path.join(runDir, x.file), a: x.a, b: x.b, run })));
      const use = all.filter(x => x.b > startS - 0.1 && x.a < endS + 0.1).sort((a, b) => a.a - b.a);
      if (!use.length) return { ok: false, err: "Nothing recorded yet" };
      const tmp = path.join(DATA_DIR, "cliptmp"); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} fs.mkdirSync(tmp, { recursive: true });
      // stitch the pieces (MPEG-TS pieces join end to end)
      const ts = path.join(tmp, "v.ts");
      if (use.every(x => x.run === use[0].run)) {
        const out = fs.openSync(ts, "w");
        for (const s of use) { try { fs.writeSync(out, fs.readFileSync(s.full)); } catch {} }
        fs.closeSync(out);
      } else {
        // pieces from before and after a restart start their clocks from zero: the concat reader lines them up
        fs.writeFileSync(path.join(tmp, "parts.txt"), use.map(s => "file '" + s.full.replace(/\\/g, "/").replace(/'/g, "'\\''") + "'").join("\n"));
        const r = await runFF(["-hide_banner", "-y", "-f", "concat", "-safe", "0", "-i", "parts.txt", "-c", "copy", "-f", "mpegts", "v.ts"], tmp);
        if (!r.ok) { const out = fs.openSync(ts, "w"); for (const s of use.filter(x => x.run === run)) { try { fs.writeSync(out, fs.readFileSync(s.full)); } catch {} } fs.closeSync(out); }
      }
      // only the game's window: crop to it when the game isn't filling the whole screen
      let crop = "";
      if (c.window !== false && typeof gameRect === "function") {
        try {
          const g = await Promise.race([gameRect(), new Promise(r => setTimeout(() => r(null), 5000))]);
          const VW = (vidSize && vidSize.w) || 0, VH = (vidSize && vidSize.h) || 0;
          // only a real game window: landscape and a good part of the screen (never a tall app window like Sothis or Discord)
          if (g && VW && g.mw === VW && g.mh === VH && g.w >= g.h && g.w >= 640 && g.w * g.h >= VW * VH * 0.3 && (g.w < VW - 8 || g.h < VH - 8)) {
            const k = ENC[encIdx].soft && VH > 1080 ? 1080 / VH : 1;
            const ev = n => Math.max(2, Math.floor(n * k / 2) * 2);
            let x = Math.max(0, g.x - g.mx), y = Math.max(0, g.y - g.my), w = Math.min(g.w, VW - x), h = Math.min(g.h, VH - y);
            crop = `crop=${ev(w)}:${ev(h)}:${ev(x)}:${ev(y)},`;
          }
        } catch {}
      }
      // full quality, like Medal: when nothing needs cropping the video is copied straight from the recording (no second
      // compression), starting at the nearest 2-second piece; otherwise it's re-encoded at very high quality
      const overlay = false; // key overlay removed
      const copyV = !crop && !overlay;
      const clipStart = copyV ? use[0].a : Math.max(startS, use[0].a);
      const clipLen = copyV ? Math.min(len + SEG, endS - clipStart) : Math.min(len, endS - clipStart);
      const off = copyV ? 0 : Math.max(0, clipStart - use[0].a);
      const wall0 = wallOff + clipStart * 1000;
      // sound for exactly that time
      let audio = null; try { audio = await requestAudio(wall0 + (+c.audioOffset || 0), clipLen); } catch {}
      let haveAudio = false, haveMic = false, haveVoice = false;
      if (audio && audio.pcm && (audio.pcm.byteLength || audio.pcm.length)) { fs.writeFileSync(path.join(tmp, "a.wav"), wav(Buffer.from(audio.pcm), audio.rate || 48000, audio.ch || 2)); haveAudio = true; }
      if (haveAudio && audio.voice && (audio.voice.byteLength || audio.voice.length)) { fs.writeFileSync(path.join(tmp, "d.wav"), wav(Buffer.from(audio.voice), audio.rate || 48000, 2)); haveVoice = true; }
      if (haveAudio && audio.mic && (audio.mic.byteLength || audio.mic.length)) { fs.writeFileSync(path.join(tmp, "m.wav"), wav(Buffer.from(audio.mic), audio.rate || 48000, 1)); haveMic = true; }
      const ns = haveMic ? nsFilter(c.noise, tmp) : "";
      // key overlay
      const W = (vidSize && vidSize.w) || 1920, H = (vidSize && vidSize.h) || 1080;
      if (overlay) fs.writeFileSync(path.join(tmp, "keys.ass"), overlayAss(wall0, clipLen, ENC[encIdx].soft && H > 1080 ? Math.round(W * 1080 / H) : W, ENC[encIdx].soft && H > 1080 ? 1080 : H));
      // where it goes: <clips>/<Game>/<Game N>.mp4
      const game = String(currentGame() || "").replace(/[<>:"/\\|?*]/g, "").trim();
      const dir = game ? path.join(clipsDir(), game) : clipsDir(); fs.mkdirSync(dir, { recursive: true });
      const base = game || "Clip";
      let count = 0; try { count = fs.readdirSync(dir).filter(n => VID_RE.test(n)).length; } catch {}
      let n = count + 1, file = path.join(dir, `${base} ${n}.mp4`); while (fs.existsSync(file)) file = path.join(dir, `${base} ${++n}.mp4`);
      const q = Math.max(14, qp() - 3);
      const encs = copyV ? [["-c:v", "copy"]] : [["-c:v", "h264_amf", "-quality", "quality", "-rc", "cqp", "-qp_i", String(q), "-qp_p", String(q + 1), "-bf", "0"], ["-c:v", "h264_nvenc", "-preset", "p6", "-tune", "hq", "-rc", "constqp", "-qp", String(q)], ["-c:v", "h264_qsv", "-global_quality", String(q)], ["-c:v", "libx264", "-preset", "fast", "-crf", String(q + 1)]];
      let res = { ok: false, err: "" };
      // tracks: 1 = the mix you hear (what Discord and players play), 2 = game sound, 3 = your mic (cleaned up), so the editor can remix them
      const sv = c.sysMute ? 0 : (+c.sysVol || 0) / 100, mv = c.micMute ? 0 : (+c.micVol || 0) / 100, dv = c.voiceMute ? 0 : (+c.voiceVol || 0) / 100;
      let fc = copyV ? "" : `[0:v]${crop}${overlay ? "subtitles=keys.ass," : ""}format=yuv420p[v]`;
      const sep = fc ? ";" : "";
      const amap = [];
      // inputs: 1 = game, then Discord (if split), then mic
      const parts2 = [], titles = [];
      if (haveAudio) {
        // every track goes through a limiter so it never goes past full volume (no crackle on loud moments), and the mix gets its own
        const LIM = "alimiter=limit=0.95:attack=2:release=60:level=0", LIMX = "alimiter=limit=0.89:attack=2:release=80:level=0";
        let i = 1, body = `[1:a]asplit=2[g1][g2r];[g1]volume=${sv.toFixed(2)}[gv];[g2r]${LIM}[g2]`; parts2.push("[gv]"); titles.push(["[g2]", "Game"]);
        if (haveVoice) { i++; body += `;[${i}:a]asplit=2[d1][d2r];[d1]volume=${dv.toFixed(2)}[dv];[d2r]${LIM}[d2]`; parts2.push("[dv]"); titles.push(["[d2]", "Discord"]); }
        if (haveMic) { i++; body += `;[${i}:a]${ns}asplit=2[m1][m2r];[m1]volume=${mv.toFixed(2)},pan=stereo|c0=c0|c1=c0[mv];[m2r]${LIM}[m2]`; parts2.push("[mv]"); titles.push(["[m2]", "Mic"]); }
        body += `;${parts2.join("")}` + (parts2.length > 1 ? `amix=inputs=${parts2.length}:normalize=0:duration=first,` : "") + LIMX + "[mix]";
        fc += sep + body;
        amap.push("-map", "[mix]", "-metadata:s:a:0", "handler_name=Mix", "-disposition:a:0", "default");
        titles.forEach(([lab, t], k) => amap.push("-map", lab, `-metadata:s:a:${k + 1}`, "handler_name=" + t, `-disposition:a:${k + 1}`, "0"));
      }
      for (const e of encs) {
        const args = ["-hide_banner", "-y", ...(copyV ? [] : ["-ss", off.toFixed(3)]), "-i", "v.ts", ...(haveAudio ? ["-i", "a.wav"] : []), ...(haveVoice ? ["-i", "d.wav"] : []), ...(haveMic ? ["-i", "m.wav"] : []), "-t", clipLen.toFixed(3),
          ...(fc ? ["-filter_complex", fc] : []), "-map", copyV ? "0:v:0" : "[v]", ...amap, ...e,
          ...(haveAudio ? ["-c:a", "aac", "-b:a", "256k"] : []), ...(copyV ? ["-avoid_negative_ts", "make_zero"] : []), "-movflags", "+faststart", file];
        res = await runFF(args, tmp);
        if (res.ok) break;
        try { fs.unlinkSync(file); } catch {}
      }
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
      if (!res.ok) { log("clips: save failed: " + res.err.split("\n").filter(Boolean).slice(-2).join(" | ")); return { ok: false, err: "Couldn't save the clip" }; }
      log("clips: saved " + path.basename(file) + " (" + clipLen.toFixed(1) + " s, " + (copyV ? "straight copy" : "re-encoded") + (overlay ? ", keys" : "") + (haveAudio ? ", sound" : ", no sound") + ")");
      try { notify(path.basename(file, ".mp4"), file); } catch {}
      return { ok: true, name: path.basename(file), file };
    } finally { saving = false; }
  }

  return {
    start, stop, save, ffEnsure, ffExe,
    state: () => Object.assign({}, st, { ready: !!ffExe(), recording: !!ff, keys: hookActive(), cfg: cfg() }),
    keyName: () => cfg().key,
    hookActive, hookStart, followGame,
    _inject: evs => { inputs = evs; hookOk = true; hook = hook || { fake: true }; },
    applyAudio: () => { if (ff) setAudio(audioCfg()); },
    restart: () => { if (ff) { const was = want; stop(); setTimeout(() => { if (was) start(); }, 2000); } }
  };
};
