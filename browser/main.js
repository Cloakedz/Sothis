// Blackwall: a small tabbed web browser in the Sothis style. Everything it keeps (sign-ins, history, bookmarks,
// settings) stays in %APPDATA%\Blackwall on this PC.
const { app, BrowserWindow, ipcMain, session, Menu, clipboard, shell, nativeImage, dialog } = require("electron");
const path = require("path"), fs = require("fs");

app.setAppUserModelId("Blackwall");
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
ipcMain.handle("data:clear", async () => { const ses = session.fromPartition("persist:web"); await ses.clearCache(); await ses.clearStorageData(); return true; });
ipcMain.on("open-external", (_e, u) => { if (/^https?:\/\//i.test(String(u))) shell.openExternal(u); });

app.on("second-instance", (_e, argv) => {
  if (!win) return; if (win.isMinimized()) win.restore(); win.focus();
  const u = argv.find(a => /^https?:\/\//i.test(a)); if (u) send("web:open", { url: u, bg: false });
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
  } catch (e) { upd.state = "error"; upd.err = String(e.message || e); }
  finally { updBusy = false; }
  return upd;
}
ipcMain.handle("upd:get", () => Object.assign({ version: APP_VER }, upd));
ipcMain.on("upd:restart", () => { app.relaunch(); app.exit(0); });
app.whenReady().then(wvReady).then(() => { setupSession(); adLoad(); createWindow(); setTimeout(updCheck, 15000); setInterval(updCheck, 3 * 3600e3); });
app.on("window-all-closed", () => app.quit());
