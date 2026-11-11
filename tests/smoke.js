// Sothis click-through test. Opens the real app with a throwaway data folder (your settings, sign-ins and clips are
// never touched), visits every page, opens the pop-ups and reports anything that throws an error.
// Run before sending an update:   electron tests/smoke.js      (Linux: xvfb-run -a electron --no-sandbox tests/smoke.js)
// Prints one line per check and exits 0 only if every check passed. SOTHIS_SHOTS=folder also saves a picture of each page.
const { app, BrowserWindow } = require("electron");
const path = require("path"), fs = require("fs"), os = require("os");
const ROOT = path.join(__dirname, "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sothis-test-"));
app.setPath("appData", TMP); app.setPath("userData", path.join(TMP, "Sothis"));
app.setAppPath(ROOT); process.chdir(ROOT);
if (process.platform === "linux") app.commandLine.appendSwitch("no-sandbox");
const SHOTS = process.env.SOTHIS_SHOTS || "";
const results = [], errors = [], mainErrors = [];
const W = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, pass, info) => { results.push({ name, pass: !!pass }); console.log((pass ? "PASS  " : "FAIL  ") + name + (pass || info == null ? "" : "   -> " + (typeof info === "string" ? info : JSON.stringify(info)))); };
// Windows-only helpers can't start on other systems, and the test has no internet: those aren't Sothis bugs
const NOISE = /ENOENT|powershell|ERR_TUNNEL|ERR_INTERNET|ERR_NAME_NOT|ERR_CONNECTION|ERR_PROXY|ERR_FAILED|net::|Failed to fetch|fetch failed|node-hid|Electron Security Warning|Autofill|ERR_ABORTED|getaddrinfo|ECONNREFUSED|EAI_AGAIN|Failed to load resource/i;
process.on("uncaughtException", e => { const s = String(e && e.stack || e); if (!NOISE.test(s)) mainErrors.push(s.split("\n").slice(0, 3).join(" | ")); });
process.on("unhandledRejection", e => { const s = String(e && e.stack || e); if (!NOISE.test(s)) mainErrors.push("unhandled: " + s.split("\n").slice(0, 3).join(" | ")); });

require(path.join(ROOT, "main.js"));
app.whenReady().then(async () => {
  let w = null; for (let i = 0; i < 150 && !w; i++) { w = BrowserWindow.getAllWindows().find(x => /index\.html/.test(x.webContents.getURL())); if (!w) await W(100); }
  if (!w) { console.log("FAIL  main window opens"); app.exit(1); return; }
  let where = "start-up";
  w.webContents.on("console-message", (_e, level, msg, line, src) => { if (level >= 3 && !NOISE.test(msg)) errors.push("[" + where + "] " + String(msg).slice(0, 260) + " (" + path.basename(String(src)) + ":" + line + ")"); });
  w.webContents.on("render-process-gone", (_e, d) => errors.push("window crashed: " + d.reason));
  const js = s => w.webContents.executeJavaScript(s, true);
  const until = async (expr, ms = 6000) => { const t = Date.now(); for (;;) { let v = null; try { v = await js(expr); } catch {} if (v) return v; if (Date.now() - t > ms) return v; await W(150); } };
  const shot = async name => { if (!SHOTS) return; try { fs.mkdirSync(SHOTS, { recursive: true }); fs.writeFileSync(path.join(SHOTS, name + ".png"), (await w.capturePage()).toPNG()); } catch {} };
  const click = id => js(`(() => { const e = document.getElementById(${JSON.stringify(id)}); if (!e) return false; e.click(); return true; })()`);
  // what's on top in the middle of the window: catches a stray overlay covering the app
  const topMost = () => js(`(() => { const e = document.elementFromPoint(innerWidth / 2, innerHeight / 2); let n = e, out = []; while (n && n !== document.body && out.length < 4) { out.push((n.id ? "#" + n.id : "") + (n.className && typeof n.className === "string" ? "." + n.className.split(" ")[0] : n.tagName)); n = n.parentElement; } return out.join(" < "); })()`);
  try {
    ok("page finishes loading", await until(`document.readyState === "complete" && !!document.getElementById("tab-home")`, 15000));
    await W(3500);   // splash
    ok("no error while starting up", errors.length === 0, errors.slice(0, 6));
    // the once-a-day briefing covers the window on a fresh start: check it shows, then close it like you would
    const brief = await until(`!!document.getElementById("dsGo")`, 9000);
    if (brief) { await shot("0-briefing"); await click("dsGo"); ok("daily briefing closes with its button", await until(`!document.getElementById("dsGo") || document.getElementById("dsGo").offsetParent === null`, 3000)); }
    const tabs = await js(`[...document.querySelectorAll("[id^=tabbtn-]")].filter(b => !b.hidden && b.offsetParent !== null).map(b => b.id.slice(7))`);
    ok("tab buttons are there", tabs.length >= 4, tabs);
    ok("nothing is covering the window", !/phbox|splash|ds-/i.test(await topMost()), await topMost());
    await shot("0-home");
    for (const t of tabs) {
      where = "page " + t; const before = errors.length;
      await click("tabbtn-" + t); await W(1200);
      const on = await js(`(() => { const p = document.getElementById("tab-" + ${JSON.stringify(t)}); return !!p && !p.classList.contains("off"); })()`);
      const cover = await topMost();
      ok("page opens: " + t, on && errors.length === before && !/phbox|ds-/i.test(cover), !on ? "page didn't show" : /phbox|ds-/i.test(cover) ? "covered by " + cover : errors.slice(before, before + 4));
      await shot("1-" + t);
    }
    for (const [id, pop, label] of [["setBtn", "tab-settings", "Settings"]]) {
      where = label; const before = errors.length;
      await click(id); await W(1000);
      ok(label + " opens", await js(`!document.getElementById(${JSON.stringify(pop)}).classList.contains("off")`) && errors.length === before, errors.slice(before, before + 4));
      ok("nothing is covering " + label, !/phbox/i.test(await topMost()), await topMost());
      await shot("2-settings");
      // every section of Settings, if it has its own tabs
      const secs = await js(`[...document.querySelectorAll("#tab-settings [role=tab], #tab-settings .set-nav button")].filter(b => b.offsetParent !== null).length`);
      for (let i = 0; i < secs; i++) { const b4 = errors.length; await js(`[...document.querySelectorAll("#tab-settings [role=tab], #tab-settings .set-nav button")].filter(b => b.offsetParent !== null)[${i}].click(); 1`); await W(350); if (errors.length !== b4) ok("Settings section " + (i + 1) + " opens", false, errors.slice(b4, b4 + 3)); }
      ok("Settings sections open (" + secs + ")", true);
      await click(id); await W(500);
    }
    where = "game list"; let b = errors.length;
    await click("setBtn"); await W(600);
    await js(`window.desktop.gamesMark({ exe: "testgame.exe", game: true, name: "Test Game" })`); await click("gdRefresh");
    ok("a game you mark shows in Settings → Gaming", await until(`/Test Game/.test(document.getElementById("gdList").textContent) && /marked by you/.test(document.getElementById("gdList").textContent)`, 3000) && errors.length === b, await js(`document.getElementById("gdList").textContent.slice(0, 200)`));
    await js(`[...document.querySelectorAll("#gdList .gd-row button")].find(x => x.textContent === "Not a game").click(); 1`);
    ok("…and can be marked as not a game", await until(`/marked not a game/.test(document.getElementById("gdList").textContent)`, 3000), await js(`document.getElementById("gdList").textContent.slice(0, 200)`));
    await js(`window.desktop.gamesMark({ exe: "testgame.exe", game: null })`);
    await click("setBtn"); await W(400);
    where = "sound mixer"; b = errors.length;
    await click("sndBtn"); await W(900);
    ok("sound mixer opens", await js(`!document.getElementById("sndPop").hidden`) && errors.length === b, errors.slice(b, b + 4));
    await click("sndBtn"); await W(300);
    where = "notifications"; b = errors.length;
    await click("tabbtn-" + (tabs.includes("ytm") ? "ytm" : tabs[0])); await W(600);
    await click("bellBtn"); await W(600);
    ok("notifications open", await js(`!document.getElementById("bellPop").hidden`) && errors.length === b, errors.slice(b, b + 4));
    await click("bellBtn"); await W(300);
    where = "clips"; b = errors.length;
    await click("tabbtn-home"); await W(600);
    if (await click("hmClipDir")) { await W(1200); ok("Clips page opens", await js(`!document.getElementById("tab-clips").classList.contains("off")`) && errors.length === b, errors.slice(b, b + 4)); await shot("3-clips"); }
    // pages go back to their first view on the next launch (a reload stands in for one)
    await js(`["st.game", "yt.view", "gm.mode", "fl.kind", "set.tab"].forEach((k, i) => localStorage.setItem(k, ["cs", "spot", "mods", "mp3", "Clips"][i])); location.reload(); 1`).catch(() => {});
    await W(2500); await until(`document.readyState === "complete" && !!document.getElementById("tab-home")`, 10000);
    ok("each page starts on its first view after a relaunch", await js(`["st.game", "yt.view", "gm.mode", "fl.kind", "set.tab"].every(k => localStorage.getItem(k) === null)`), await js(`JSON.stringify(["st.game", "yt.view", "gm.mode", "fl.kind", "set.tab"].map(k => localStorage.getItem(k)))`));
    await W(4000); await click("dsGo"); await W(400);
    where = "keyboard"; b = errors.length;
    for (const k of ["Escape", "ArrowLeft", "ArrowRight", " ", "f", "m", "/", "Tab"]) { await js(`document.body.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(k)}, bubbles: true })); 1`); await W(120); }
    ok("keyboard shortcuts don't throw", errors.length === b, errors.slice(b, b + 4));
    await click("tabbtn-home"); await W(800);
    where = "resize"; b = errors.length;
    for (const [x, y] of [[1500, 900], [900, 620], [1280, 800]]) { w.setSize(x, y); await W(500); }
    ok("resizing the window doesn't throw", errors.length === b, errors.slice(b, b + 4));
    ok("nothing left covering the window at the end", !/phbox/i.test(await topMost()), await topMost());
  } catch (e) { ok("test ran to the end", false, String(e && e.stack || e).slice(0, 300)); }
  ok("no errors in the app's background code", mainErrors.length === 0, mainErrors.slice(0, 6));
  const bad = results.filter(r => !r.pass);
  console.log("\n" + (bad.length ? bad.length + " of " + results.length + " checks FAILED" : "All " + results.length + " checks passed"));
  if (errors.length) { console.log("\nEvery error seen:"); [...new Set(errors)].slice(0, 40).forEach(e => console.log("  " + e)); }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  app.exit(bad.length ? 1 : 0);
});
