// Blackwall: a small tabbed web browser in the Sothis style. Everything it keeps (sign-ins, history, bookmarks,
// settings) stays in %APPDATA%\Blackwall on this PC.
const { app, BrowserWindow, ipcMain, session, Menu, clipboard, shell, nativeImage, dialog } = require("electron");
const path = require("path"), fs = require("fs");

app.setAppUserModelId("Blackwall");
// use less memory: let tabs of the same site share a process, and give pages a smaller memory ceiling
app.commandLine.appendSwitch("renderer-process-limit", "8");
app.commandLine.appendSwitch("js-flags", "--max-old-space-size=1024");
app.commandLine.appendSwitch("disable-features", "BackForwardCache,SpareRendererForSitePerProcess");
// your data folder is %APPDATA%\Blackwall; it was "Sothis Browser" before the rename, so that one moves over (sign-ins, tabs, bookmarks)
{
  const OLD = path.join(app.getPath("appData"), "Sothis Browser"), NEW = path.join(app.getPath("appData"), "Blackwall");
  let use = NEW;
  try { if (fs.existsSync(OLD) && !fs.existsSync(NEW)) fs.renameSync(OLD, NEW); } catch { if (fs.existsSync(OLD) && !fs.existsSync(NEW)) use = OLD; }
  app.setPath("userData", use);
}
if (!app.requestSingleInstanceLock()) { app.quit(); return; }

const DATA = app.getPath("userData");
const SET_FILE = path.join(DATA, "settings.json");
let settings = {}; try { settings = JSON.parse(fs.readFileSync(SET_FILE, "utf8")) || {}; } catch {}
const saveSettings = () => { try { fs.writeFileSync(SET_FILE, JSON.stringify(settings, null, 1)); } catch {} };

// the current Chrome version (Chrome ships every 4 weeks; 131 came out 12 Nov 2024): Google turns away out-of-date browsers too
const CHROME_MAJOR = String(Math.max(+process.versions.chrome.split(".")[0], 131 + Math.floor((Date.now() - Date.UTC(2024, 10, 12)) / (28 * 864e5))));
const CHROME_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_MAJOR}.0.0.0 Safari/537.36`;
app.userAgentFallback = CHROME_UA;

/* ---------- ad and tracker blocking ---------- */
const AD_BUILTIN = ["doubleclick.net", "googlesyndication.com", "googleadservices.com", "adservice.google.com", "pagead2.googlesyndication.com", "googletagservices.com",
  "google-analytics.com", "adnxs.com", "adsrvr.org", "advertising.com", "amazon-adsystem.com", "taboola.com", "outbrain.com", "criteo.com", "criteo.net", "pubmatic.com",
  "rubiconproject.com", "openx.net", "casalemedia.com", "smartadserver.com", "moatads.com", "scorecardresearch.com", "quantserve.com", "adform.net", "yieldmo.com",
  "sharethrough.com", "teads.tv", "media.net", "zedo.com", "propellerads.com", "popads.net", "popcash.net", "adcash.com", "exoclick.com", "juicyads.com",
  "trafficjunky.net", "mgid.com", "revcontent.com", "adroll.com", "bidswitch.net", "33across.com", "indexww.com", "lijit.com", "sovrn.com", "contextweb.com",
  "spotxchange.com", "spotx.tv", "springserve.com", "unrulymedia.com", "yieldlab.net", "adition.com", "adsafeprotected.com", "doubleverify.com", "imasdk.googleapis.com",
  "ads.yahoo.com", "ads.twitter.com", "ads-twitter.com", "static.ads-twitter.com", "ads.linkedin.com", "adsymptotic.com", "hotjar.com", "mouseflow.com", "zergnet.com",
  "onclickads.net", "onclkds.com", "adsterra.com", "hilltopads.net", "clickadu.com", "admaven.com", "a-ads.com", "coinzilla.com", "bitmedia.io", "ad.plus", "adskeeper.com"];
let adHosts = new Set(AD_BUILTIN);
const adCounts = new Map();
function adIsBlocked(host) { for (let h = host; h && h.includes("."); h = h.slice(h.indexOf(".") + 1)) if (adHosts.has(h)) return true; return false; }
async function adLoad() {
  const f = path.join(DATA, "adblock-hosts.txt");
  const use = txt => { const set = new Set(AD_BUILTIN); for (const l of String(txt).split(/\r?\n/)) { const h = l.trim().toLowerCase(); if (h && !h.startsWith("#") && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(h)) set.add(h); } if (set.size > AD_BUILTIN.length) adHosts = set; };
  try { use(fs.readFileSync(f, "utf8")); } catch {}
  try {
    const st = fs.existsSync(f) ? fs.statSync(f) : null;
    if (st && Date.now() - st.mtimeMs < 3 * 864e5) return;
    const { net } = require("electron");
    const r = await net.fetch("https://pgl.yoyo.org/adservers/serverlist.php?hostformat=nohtml&showintro=0&mimetype=plaintext");
    if (r.ok) { const t = await r.text(); if (t.length > 1000) { fs.writeFileSync(f, t); use(t); } }
  } catch {}
}

let win = null;
const send = (ch, d) => { try { if (win && !win.isDestroyed()) win.webContents.send(ch, d); } catch {} };

function setupSession() {
  const ses = session.fromPartition("persist:web");
  ses.setUserAgent(CHROME_UA);
  ses.setPermissionRequestHandler((_wc, perm, cb) => cb(["fullscreen", "clipboard-sanitized-write", "notifications", "media", "pointerLock", "keyboardLock"].includes(perm)));
  ses.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*"] }, (d, cb) => {
    if (settings.adBlock === false || d.resourceType === "mainFrame") return cb({});
    let host = ""; try { host = new URL(d.url).hostname.toLowerCase(); } catch { return cb({}); }
    if (!adIsBlocked(host)) return cb({});
    if (d.webContentsId) { const n = (adCounts.get(d.webContentsId) || 0) + 1; adCounts.set(d.webContentsId, n); send("web:blocked", { id: d.webContentsId, n }); }
    cb({ cancel: true });
  });
  // downloads go straight to your Downloads folder, with progress in the downloads list
  ses.on("will-download", (_e, item) => {
    const dir = app.getPath("downloads");
    let name = item.getFilename() || "download", file = path.join(dir, name), n = 1;
    while (fs.existsSync(file)) { const ext = path.extname(name); file = path.join(dir, path.basename(name, ext) + " (" + n++ + ")" + ext); }
    item.setSavePath(file);
    const id = Date.now() + Math.random();
    const upd = state => send("dl:update", { id, name: path.basename(file), file, state, got: item.getReceivedBytes(), total: item.getTotalBytes() });
    upd("progress");
    item.on("updated", (_e2, st) => upd(st === "interrupted" ? "interrupted" : "progress"));
    item.once("done", (_e2, st) => upd(st));
  });
  return ses;
}

app.on("web-contents-created", (_e, c) => {
  if (c.getType() !== "webview") return;
  // Every page sees one consistent, real Google Chrome: the name tag and the brand details agree ("Google Chrome", not
  // the bare "Chromium" an app browser reports). Google lets real Chrome sign in; a half-disguised browser it blocks.
  try {
    const major = CHROME_MAJOR, full = CHROME_MAJOR + ".0.0.0";
    c.debugger.attach("1.3");
    c.debugger.sendCommand("Emulation.setUserAgentOverride", {
      userAgent: CHROME_UA, platform: "Win32", acceptLanguage: "en-US,en",
      userAgentMetadata: {
        brands: [{ brand: "Google Chrome", version: major }, { brand: "Chromium", version: major }, { brand: "Not?A_Brand", version: "24" }],
        fullVersionList: [{ brand: "Google Chrome", version: full }, { brand: "Chromium", version: full }, { brand: "Not?A_Brand", version: "24.0.0.0" }],
        platform: "Windows", platformVersion: "15.0.0", architecture: "x86", model: "", mobile: false, bitness: "64", wow64: false
      }
    }).catch(() => {});
    c.debugger.sendCommand("Page.enable").catch(() => {});
    c.debugger.sendCommand("Page.addScriptToEvaluateOnNewDocument", { source: `try { Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false, configurable: true }); } catch (e) {}` }).catch(() => {});
  } catch {}
  // links that want a new tab or window open as a tab here; small sign-in pop-ups keep their own window
  c.setWindowOpenHandler(({ url, disposition, features }) => {
    if (!/^https?:\/\//i.test(url) && url !== "about:blank") return { action: "deny" };
    const signIn = /(accounts\.google|login|signin|sign-in|oauth|auth|sso|appleid|discord\.com\/(api\/)?oauth|paypal|checkout|steamcommunity\.com\/openid)/i.test(url);
    if (disposition === "new-window" && (signIn || features)) {
      if (!signIn && settings.popBlock !== false) { send("web:popup", { url, from: c.id }); return { action: "deny" }; }
      return { action: "allow", overrideBrowserWindowOptions: { width: 520, height: 680, autoHideMenuBar: true, backgroundColor: "#0b0b0f", icon: path.join(__dirname, "assets", "blackwall.png"), webPreferences: { partition: "persist:web" } } };
    }
    send("web:open", { url, bg: disposition === "background-tab" });
    return { action: "deny" };
  });
  // shortcuts work while a page has focus
  c.on("before-input-event", (ev, i) => {
    if (i.type !== "keyDown") return;
    const k = String(i.key || "").toLowerCase(), ctl = i.control || i.meta;
    let combo = null;
    if (ctl && !i.alt) combo = i.shift ? ({ t: "ctrl+shift+t", tab: "ctrl+shift+tab", i: null }[k] || null) : (["t", "w", "l", "r", "tab", "d", "h", "j", "f", "1", "2", "3", "4", "5", "6", "7", "8", "9", "=", "+", "-", "0"].includes(k) ? "ctrl+" + k : null);
    else if (k === "f5") combo = "f5"; else if (k === "f11") combo = "f11"; else if (k === "f12") combo = "f12";
    else if (i.alt && !ctl && (k === "arrowleft" || k === "arrowright" || k === "home")) combo = "alt+" + k;
    if (!combo) return;
    ev.preventDefault(); send("web:key", combo);
  });
  c.on("context-menu", (_ev, p) => {
    const items = [];
    if (p.linkURL) items.push({ label: "Open link in new tab", click: () => send("web:open", { url: p.linkURL, bg: true }) }, { label: "Copy link", click: () => clipboard.writeText(p.linkURL) }, { type: "separator" });
    if (p.mediaType === "image" && p.srcURL) items.push({ label: "Open image in new tab", click: () => send("web:open", { url: p.srcURL, bg: true }) }, { label: "Save image", click: () => c.downloadURL(p.srcURL) }, { label: "Copy image", click: () => c.copyImageAt(p.x, p.y) }, { type: "separator" });
    if (p.mediaType === "video") items.push({ label: "Picture in picture", click: () => c.executeJavaScript(`(() => { const v = document.elementFromPoint(${p.x}, ${p.y}); const vid = v && (v.closest("video") || v.querySelector && v.querySelector("video")) || document.querySelector("video"); if (vid) vid.requestPictureInPicture().catch(() => {}); })()`, true) }, { type: "separator" });
    if (p.isEditable) items.push({ role: "undo" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }, { type: "separator" });
    else if (p.selectionText) items.push({ role: "copy" }, { label: `Search for "${p.selectionText.slice(0, 24)}${p.selectionText.length > 24 ? "…" : ""}"`, click: () => send("web:open", { url: "https://www.google.com/search?q=" + encodeURIComponent(p.selectionText), bg: false }) }, { type: "separator" });
    items.push({ label: "Back", enabled: c.navigationHistory.canGoBack(), click: () => c.navigationHistory.goBack() }, { label: "Forward", enabled: c.navigationHistory.canGoForward(), click: () => c.navigationHistory.goForward() }, { label: "Reload", click: () => c.reload() }, { type: "separator" }, { label: "Inspect", click: () => c.inspectElement(p.x, p.y) });
    Menu.buildFromTemplate(items).popup({ window: win });
  });
});

function createWindow() {
  const b = settings.bounds || {};
  win = new BrowserWindow({
    width: b.width || 1280, height: b.height || 820, x: b.x, y: b.y, minWidth: 520, minHeight: 360,
    frame: false, backgroundColor: "#07070a", show: false, title: "Blackwall", icon: path.join(__dirname, "assets", "blackwall.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: true }
  });
  win.removeMenu();
  if (settings.maximized) win.maximize();
  win.once("ready-to-show", () => win.show());
  win.loadFile(path.join(__dirname, "index.html"));
  const keep = () => { if (!win.isMaximized() && !win.isMinimized() && !win.isFullScreen()) settings.bounds = win.getBounds(); settings.maximized = win.isMaximized(); };
  win.on("resize", keep); win.on("move", keep);
  win.on("close", () => { keep(); saveSettings(); });
  for (const ev of ["maximize", "unmaximize", "enter-full-screen", "leave-full-screen"]) win.on(ev, () => send("win:state", { max: win.isMaximized(), full: win.isFullScreen() }));
}

ipcMain.on("win:min", () => win.minimize());
ipcMain.on("win:max", () => (win.isMaximized() ? win.unmaximize() : win.maximize()));
ipcMain.on("win:close", () => win.close());
ipcMain.on("win:full", (_e, on) => win.setFullScreen(on === undefined ? !win.isFullScreen() : !!on));
ipcMain.handle("cfg:get", () => ({ adBlock: settings.adBlock !== false, popBlock: settings.popBlock !== false, search: settings.search || "google" }));
ipcMain.handle("cfg:set", (_e, o) => { for (const k of ["adBlock", "popBlock", "search"]) if (o && k in o) settings[k] = o[k]; saveSettings(); return { adBlock: settings.adBlock !== false, popBlock: settings.popBlock !== false, search: settings.search || "google" }; });
ipcMain.handle("ad:count", (_e, id) => adCounts.get(id) || 0);
ipcMain.handle("dl:open", (_e, f) => { if (typeof f === "string" && fs.existsSync(f)) shell.openPath(f); });
ipcMain.handle("dl:show", (_e, f) => { if (typeof f === "string" && fs.existsSync(f)) shell.showItemInFolder(f); });
ipcMain.handle("dl:folder", () => shell.openPath(app.getPath("downloads")));
// Import bookmarks from Chrome (or Edge, Brave, Opera GX): reads their Bookmarks file on this PC; nothing leaves the PC
ipcMain.handle("import:bookmarks", (_e, which) => {
  const L = process.env.LOCALAPPDATA || "", R = process.env.APPDATA || "";
  const places = { chrome: path.join(L, "Google", "Chrome", "User Data"), edge: path.join(L, "Microsoft", "Edge", "User Data"), brave: path.join(L, "BraveSoftware", "Brave-Browser", "User Data"), operagx: path.join(R, "Opera Software", "Opera GX Stable") };
  const base = places[which] || places.chrome;
  const files = [];
  try { if (fs.existsSync(path.join(base, "Bookmarks"))) files.push(path.join(base, "Bookmarks")); for (const d of fs.readdirSync(base)) if (/^(Default|Profile \d+)$/.test(d) && fs.existsSync(path.join(base, d, "Bookmarks"))) files.push(path.join(base, d, "Bookmarks")); } catch {}
  if (!files.length) return { ok: false, err: "Couldn't find that browser's bookmarks on this PC." };
  const conv = n => n.type === "folder" ? { f: true, t: n.name || "Folder", items: (n.children || []).map(conv).filter(Boolean) } : (n.type === "url" && /^https?:/i.test(n.url || "") ? { u: n.url, t: n.name || n.url } : null);
  const out = [];
  for (const f of files) {
    try {
      const j = JSON.parse(fs.readFileSync(f, "utf8")), r = j.roots || {};
      const prof = path.basename(path.dirname(f));
      const items = [];
      if (r.bookmark_bar) items.push(...(r.bookmark_bar.children || []).map(conv).filter(Boolean));
      for (const k of ["other", "synced"]) if (r[k] && (r[k].children || []).length) items.push({ f: true, t: k === "other" ? "Other bookmarks" : "Mobile bookmarks", items: r[k].children.map(conv).filter(Boolean) });
      if (items.length) out.push({ prof, items });
    } catch {}
  }
  return { ok: true, profiles: out };
});
// Top-row stats: memory used by every Blackwall process, time since it opened, and ping to the site you're on
const START_AT = Date.now();
ipcMain.handle("stats:get", () => {
  let kb = 0; try { for (const m of app.getAppMetrics()) kb += (m.memory && (m.memory.workingSetSize || 0)) || 0; } catch {}
  return { ramMB: Math.round(kb / 1024), upS: Math.floor((Date.now() - START_AT) / 1000) };
});
ipcMain.handle("stats:ping", async (_e, url) => {
  let origin = ""; try { const u = new URL(String(url)); if (!/^https?:$/.test(u.protocol)) return null; origin = u.origin; } catch { return null; }
  const { net } = require("electron");
  const once = async () => { const t0 = performance.now(); const c = new AbortController(); const to = setTimeout(() => c.abort(), 4000); try { await session.fromPartition("persist:web").fetch(origin + "/favicon.ico", { method: "HEAD", cache: "no-store", signal: c.signal }); return performance.now() - t0; } catch { return null; } finally { clearTimeout(to); } };
  await once();   // the first one opens the connection; the second is the real round trip
  const ms = await once();
  return ms == null ? null : Math.round(ms);
});
ipcMain.handle("data:clear", async () => { const ses = session.fromPartition("persist:web"); await ses.clearCache(); await ses.clearStorageData(); return true; });
ipcMain.on("open-external", (_e, u) => { if (/^https?:\/\//i.test(String(u))) shell.openExternal(u); });

/* ---------- default browser: Blackwall lists itself in Windows as a browser (for you only, no admin); you pick it in Settings ---------- */
function regBrowser() {
  if (process.platform !== "win32" || !app.isPackaged) return;
  const exe = process.execPath, ico = path.join(path.dirname(exe), "blackwall.ico"), cmd = `"${exe}" "%1"`;
  const K = "HKCU\\Software", C = K + "\\Clients\\StartMenuInternet\\Blackwall";
  const rows = [
    [K + "\\Classes\\BlackwallHTML", "", "Blackwall web page"], [K + "\\Classes\\BlackwallHTML", "URL Protocol", ""],
    [K + "\\Classes\\BlackwallHTML\\DefaultIcon", "", ico + ",0"], [K + "\\Classes\\BlackwallHTML\\shell\\open\\command", "", cmd],
    [K + "\\Classes\\BlackwallHTML\\Application", "ApplicationName", "Blackwall"], [K + "\\Classes\\BlackwallHTML\\Application", "ApplicationIcon", ico + ",0"],
    [C, "", "Blackwall"], [C + "\\DefaultIcon", "", ico + ",0"], [C + "\\shell\\open\\command", "", `"${exe}"`],
    [C + "\\Capabilities", "ApplicationName", "Blackwall"], [C + "\\Capabilities", "ApplicationDescription", "Blackwall, a web browser in the Sothis style"], [C + "\\Capabilities", "ApplicationIcon", ico + ",0"],
    [C + "\\Capabilities\\URLAssociations", "http", "BlackwallHTML"], [C + "\\Capabilities\\URLAssociations", "https", "BlackwallHTML"],
    [C + "\\Capabilities\\FileAssociations", ".html", "BlackwallHTML"], [C + "\\Capabilities\\FileAssociations", ".htm", "BlackwallHTML"], [C + "\\Capabilities\\FileAssociations", ".pdf", "BlackwallHTML"],
    [C + "\\Capabilities\\StartMenu", "StartMenuInternet", "Blackwall"],
    [K + "\\RegisteredApplications", "Blackwall", "Software\\Clients\\StartMenuInternet\\Blackwall\\Capabilities"]
  ];
  if (settings.regFor === exe) return;   // already done for this copy
  const { execFileSync } = require("child_process");
  try { for (const [key, name, val] of rows) execFileSync("reg.exe", ["add", key].concat(name ? ["/v", name] : ["/ve"], ["/t", "REG_SZ", "/d", val, "/f"]), { windowsHide: true }); settings.regFor = exe; saveSettings(); } catch {}
}
ipcMain.handle("default:open", () => { regBrowser(); shell.openExternal("ms-settings:defaultapps?registeredAppUser=Blackwall"); return true; });
ipcMain.handle("default:is", () => { try { return /blackwall/i.test(require("child_process").execFileSync("reg.exe", ["query", "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice", "/v", "ProgId"], { windowsHide: true, encoding: "utf8" })); } catch { return false; } });
// a link or file Windows asked Blackwall to open
const argUrl = argv => { for (const a of (argv || []).slice(1)) { if (/^https?:\/\//i.test(a)) return a; if (/\.(html?|pdf)$/i.test(a) && fs.existsSync(a)) return require("url").pathToFileURL(a).href; } return ""; };
let firstUrl = argUrl(process.argv);
ipcMain.handle("start:url", () => { const u = firstUrl; firstUrl = ""; return u; });
app.on("second-instance", (_e, argv) => {
  if (!win) return; if (win.isMinimized()) win.restore(); win.focus();
  const u = argUrl(argv); if (u) send("web:open", { url: u, bg: false });
});
// the Widevine part (Netflix, Spotify and other protected video) comes from this engine's own updater; don't wait on it for long
async function wvReady() { try { const { components } = require("electron"); if (components && components.whenReady) await Promise.race([components.whenReady(), new Promise(r => setTimeout(r, 4000))]); } catch {} }
/* ---------- updates: new versions are published in the Sothis repo (browser folder); files are swapped in, then a restart ---------- */
const UPD_BASE = "https://raw.githubusercontent.com/Cloakedz/Sothis/main/browser/";
const APP_VER = require("./package.json").version;
const verCmp = (a, b) => { const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; };
let upd = { state: "idle", latest: "" }, updBusy = false;
async function updCheck() {
  if (updBusy || upd.state === "ready") return upd;
  updBusy = true;
  try {
    const { net } = require("electron");
    const get = async (f, bin) => { const r = await net.fetch(UPD_BASE + f + "?t=" + Date.now(), { headers: { "Cache-Control": "no-cache" } }); if (!r.ok) throw new Error(f + ": " + r.status); return bin ? Buffer.from(await r.arrayBuffer()) : r.text(); };
    const pk = JSON.parse(await get("package.json"));
    upd.latest = String(pk.version || "");
    if (!upd.latest || verCmp(upd.latest, APP_VER) <= 0) { upd.state = "current"; return upd; }
    const list = JSON.parse(await get("files.json"));
    if (!Array.isArray(list) || !list.includes("main.js")) throw new Error("bad file list");
    const got = {};
    for (const f of list) { if (!/^[\w./ -]+$/.test(f) || f.includes("..")) continue; got[f] = await get(f, true); }   // everything first, so a failed download changes nothing
    for (const [f, b] of Object.entries(got)) { const dst = path.join(__dirname, f); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.writeFileSync(dst, b); }
    upd.state = "ready"; send("upd:ready", { version: upd.latest });
    try { const { Notification } = require("electron"); if (Notification.isSupported() && win && !win.isFocused()) new Notification({ title: "Blackwall update ready", body: "Restart Blackwall to finish updating.", icon: path.join(__dirname, "assets", "blackwall.png"), silent: true }).show(); } catch {}
  } catch (e) { upd.state = "error"; upd.err = String(e.message || e); }
  finally { updBusy = false; }
  return upd;
}
ipcMain.handle("upd:get", () => Object.assign({ version: APP_VER }, upd));
ipcMain.handle("upd:check", async () => { await updCheck(); return Object.assign({ version: APP_VER }, upd); });
// coming back to the window also checks (at most every 5 minutes), so a new version shows up soon after it's out
let updFocusAt = 0;
app.on("browser-window-focus", () => { if (Date.now() - updFocusAt > 2 * 60e3) { updFocusAt = Date.now(); updCheck(); } });
ipcMain.on("upd:restart", () => { app.relaunch(); app.exit(0); });
// any change to Blackwall's own files (an update, or new files copied in) shows the update card right away
function updWatch() {
  let t = null;
  const fire = name => {
    if (!/\.(js|html|json|png|gif|css)$/i.test(String(name || ""))) return;
    clearTimeout(t); t = setTimeout(() => {
      let v = APP_VER; try { v = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8")).version || v; } catch {}
      upd.state = "ready"; upd.latest = v; send("upd:ready", { version: v });
    }, 1500);
  };
  for (const d of [__dirname, path.join(__dirname, "assets")]) { try { fs.watch(d, (_ev, name) => fire(name)); } catch {} }
}
app.whenReady().then(wvReady).then(() => { setupSession(); adLoad(); createWindow(); setTimeout(regBrowser, 3000); setTimeout(updCheck, 15000); setInterval(updCheck, 10 * 60e3); setTimeout(updWatch, 3000); });
app.on("window-all-closed", () => app.quit());
