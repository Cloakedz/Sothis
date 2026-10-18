const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, screen, session, utilityProcess, Notification, safeStorage, dialog, globalShortcut, desktopCapturer } = require("electron");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");
const net = require("net");
const dnsp = require("dns").promises;
// Retro games: the emulator and your game files are served to the player window through this private address
require("electron").protocol.registerSchemesAsPrivileged([{ scheme: "sothisemu", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);

const MINI = { w: 400, h: 112 };
const DEFAULT_SIZES = { main: { w: 500, h: 820 }, wide: { w: 1080, h: 820 } };
const MIN = { main: { w: 420, h: 640 }, wide: { w: 680, h: 560 } };

app.setAppUserModelId("Sothis");

// Keep music smooth while Sothis is minimized, in the tray, or behind a game:
// stop Chromium from slowing down the hidden player.
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

// Look like plain Chrome so websites shown in the app (stats.cc) treat it as a normal browser.
app.userAgentFallback = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;

// Settings, sign-ins and everything personal live in this folder on each PC (Roaming\Sothis), never in the app itself.
const DATA_DIR = path.join(app.getPath("appData"), "Sothis");
// Your own defaults (your Discord servers, Minecraft server, Discord app) come from Roaming\Sothis\personal.json on your PC,
// so the app code that's shared with friends has none of them.
let personal = {};
try { personal = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "personal.json"), "utf8")) || {}; } catch {}
app.setPath("userData", DATA_DIR);
try { fs.rmSync(path.join(DATA_DIR, "Partitions", "nintendo"), { recursive: true, force: true }); } catch {}

// Only one copy at a time; opening it again just brings the window back.
if (!app.requestSingleInstanceLock()) app.quit();

const settingsFile = () => path.join(app.getPath("userData"), "window.json");
function loadSettings() {
  try { return JSON.parse(fs.readFileSync(settingsFile(), "utf8")); } catch { return {}; }
}
function saveSettings() {
  try { fs.writeFileSync(settingsFile(), JSON.stringify(settings)); } catch {}
}

let win, tray;
let settings = {};
let quitting = false;
let currentKey = "main";

const isPinned = () => settings.pinned !== false;
const isStartup = () => app.getLoginItemSettings().openAtLogin;
const sizeFor = key => Object.assign({}, DEFAULT_SIZES[key], (settings.sizes || {})[key]);
const winState = () => ({ pinned: isPinned(), mini: !!settings.mini, compact: !!settings.compact, compactSide: settings.compactSide === "left" ? "left" : "right", startup: isStartup(), lowAlert: settings.lowAlert !== false, songToast: settings.songToast !== false });

function createWindow() {
  const size = settings.mini ? MINI : sizeFor(currentKey);
  // Always open in the middle of the screen you're on
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  size.h = Math.min(size.h, area.height - 16); size.w = Math.min(size.w, area.width - 16);
  win = new BrowserWindow({
    width: size.w,
    height: size.h,
    x: Math.round(area.x + (area.width - size.w) / 2),
    y: Math.round(area.y + (area.height - size.h) / 2),
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: "#00000000",
    show: false,                       // shown once the first frame is painted, so the splash starts clean
    alwaysOnTop: isPinned(),
    title: "Sothis",
    icon: path.join(__dirname, "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      backgroundThrottling: false
    }
  });
  // "screen-saver" level keeps it above most other windows, including borderless games.
  if (isPinned()) win.setAlwaysOnTop(true, "screen-saver");
  win.removeMenu();
  win.once("ready-to-show", () => { if (!win.isDestroyed() && !win.isVisible()) win.show(); });
  win.loadFile("index.html");
  // Opera docked in Sothis follows the window around
  for (const ev of ["move", "moved", "resize", "resized", "hide", "show", "minimize", "restore"]) win.on(ev, () => { try { dockFollowAll(); } catch {} });
  // clicking Sothis brings it in front: put the docked app back on top of its page right after
  win.on("focus", () => setTimeout(() => { try { dockFollowAll(); } catch {} }, 60));
  // double-click the top bar: fullscreen on/off (Windows sends this as a double-click on the title area)
  if (process.platform === "win32") {
    try { win.hookWindowMessage(0x00A3, () => { if (!settings.mini && !settings.compact) setTimeout(() => setFull(!preFull), 0); }); } catch {}
  }

  const remember = () => {
    if (!win || win.isDestroyed()) return;
    if (settings.compact) return compactSnap();   // the sidebar snaps back to the nearest screen edge
    const [x, y] = win.getPosition();
    settings.x = x; settings.y = y;
    saveSettings();
  };
  win.on("moved", remember);
  // Closing the window hides it to the tray; Quit from the tray menu exits.
  win.on("close", e => {
    remember();
    if (!quitting) {
      e.preventDefault();
      // Closing from the taskbar or Alt+F4: show the "Close Sothis?" pop-up instead of quitting right away
      if (!win.isVisible() || win.isMinimized()) showWindow();
      win.webContents.send("close:ask");
    }
  });
  win.on("show", () => { refreshTray(); setTimeout(setThumbar, 150); });
  win.webContents.on("did-finish-load", () => setTimeout(setThumbar, 300));
  win.on("hide", refreshTray);
  // Mouse side buttons (back/forward) arrive here on Windows
  win.on("app-command", (_e, cmd) => {
    if (cmd === "browser-backward") win.webContents.send("nav:go", "back");
    else if (cmd === "browser-forward") win.webContents.send("nav:go", "fwd");
  });
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// Resize while keeping the window on screen.
function applySize(size) {
  const b = win.getBounds();
  const wa = screen.getDisplayMatching(b).workArea;
  const w = Math.min(Math.round(size.w), wa.width);
  const h = Math.min(Math.round(size.h), wa.height);
  const x = Math.min(Math.max(b.x, wa.x), wa.x + wa.width - w);
  const y = Math.min(Math.max(b.y, wa.y), wa.y + wa.height - h);
  win.setResizable(true);
  win.setBounds({ x, y, width: w, height: h }, false);
  win.setResizable(false);
}

function broadcast() {
  if (win && !win.isDestroyed()) win.webContents.send("win:state", winState());
  refreshTray();
}

function setPinned(on) {
  settings.pinned = !!on;
  win.setAlwaysOnTop(!!on, "screen-saver");
  saveSettings();
  broadcast();
}

function setMaterial(on) {
  // Windows 11 frosted glass behind the mini player (ignored on older Windows).
  try { if (process.platform === "win32" && win.setBackgroundMaterial) win.setBackgroundMaterial(on ? "acrylic" : "none"); } catch {}
}
function setMini(on) {
  if (on && settings.compact) { settings.compact = false; preCompact = null; }
  if (preFull) { preFull = null; win.webContents.send("win:full", false); }
  settings.mini = !!on;
  applySize(on ? MINI : sizeFor(currentKey));
  saveSettings();
  broadcast();
}

function setStartup(on) {
  app.setLoginItemSettings({ openAtLogin: !!on, path: process.execPath });
  broadcast();
}

/* ---------- Playback controls outside the window (tray menu + taskbar preview) ---------- */
let player = { connected: false, playing: false, volume: 0.5, title: "", artist: "" };
function remote(cmd, value) {
  if (win && !win.isDestroyed()) win.webContents.send("remote:cmd", { cmd, value });
}
const thumbIcon = n => nativeImage.createFromPath(path.join(__dirname, "thumb", n + ".png"));
function setThumbar() {
  if (!win || win.isDestroyed() || process.platform !== "win32") return;
  const flags = player.connected ? [] : ["disabled"];
  const v = Math.round(player.volume * 100);
  try {
    win.setThumbarButtons([
      { tooltip: "", icon: thumbIcon("prev"), click: () => remote("prev"), flags },
      { tooltip: "", icon: thumbIcon(player.playing ? "pause" : "play"), click: () => remote("playpause"), flags },
      { tooltip: "", icon: thumbIcon("next"), click: () => remote("next"), flags },
      { tooltip: "", icon: thumbIcon("voldown"), click: () => remote("volstep", -0.1), flags },
      { tooltip: "", icon: thumbIcon("volup"), click: () => remote("volstep", 0.1), flags },
      ...(dc.status === "ok" ? [
        { tooltip: "", icon: thumbIcon(dc.vs && dc.vs.mute ? "mic-off" : "mic"), click: () => dcToggle("mute"), flags: [] },
        { tooltip: "", icon: thumbIcon(dc.vs && dc.vs.deaf ? "deaf-off" : "deaf"), click: () => dcToggle("deaf"), flags: [] }
      ] : [])
    ]);
  } catch {}
}
ipcMain.on("player:state", (_e, p) => {
  const next = Object.assign({}, player, p);
  if (JSON.stringify(next) === JSON.stringify(player)) return;
  const thumbChanged = next.playing !== player.playing || next.connected !== player.connected || Math.round(next.volume * 100) !== Math.round(player.volume * 100);
  player = next;
  refreshTray();
  if (thumbChanged) setThumbar();
  maybeSongToast();
  dcPresenceFromPlayer();
});

/* ---------- Discord call (talks to the Discord app on this PC over its local connection) ---------- */
const DC_BASE = ["rpc", "rpc.voice.read", "rpc.voice.write"];
const DC_SCOPES = [...DC_BASE, "rpc.notifications.read"];   // mentions are a bonus; Discord may refuse that one
const DC_CH_EVTS = ["VOICE_STATE_CREATE", "VOICE_STATE_UPDATE", "VOICE_STATE_DELETE", "SPEAKING_START", "SPEAKING_STOP"];
const dc = { sock: null, buf: Buffer.alloc(0), nonce: 0, pending: new Map(), status: "off", err: "", user: null, channel: null,
  guildNames: {}, speaking: new Set(), vs: null, retry: null, subChan: null, pushT: null };
const DC_DEFAULT_ID = /^\d{15,22}$/.test(String(personal.discordClientId || "")) ? String(personal.discordClientId) : "";
const dcCfg = () => Object.assign({ clientId: DC_DEFAULT_ID }, settings.discord || {});
// Secrets and tokens are encrypted with Windows' own per-user protection before being saved.
/* Secrets (Discord app secret and tokens, OBS password) stay on this PC only: they're saved encrypted with Windows'
   own per-user encryption, so the saved file is useless anywhere else. If that encryption isn't available they're kept
   in memory for this run only and never written down in plain text. Sothis only ever sends the Discord secret to
   Discord itself (to sign in). */
const memSecrets = {};
const encSecret = v => { try { if (safeStorage.isEncryptionAvailable()) return "enc:" + safeStorage.encryptString(v).toString("base64"); } catch {} return null; };
const decSecret = v => { if (!v) return ""; try { return String(v).startsWith("enc:") ? safeStorage.decryptString(Buffer.from(String(v).slice(4), "base64")) : String(v); } catch { return ""; } };
function dcGetSecret(k) {
  if (memSecrets["dc." + k]) return memSecrets["dc." + k];
  return decSecret(dcCfg()[k]);
}
function dcPutSecret(k, val) {
  settings.discord = settings.discord || {};
  delete memSecrets["dc." + k];
  if (!val) { delete settings.discord[k]; return; }
  const e = encSecret(val);
  if (e) settings.discord[k] = e; else { delete settings.discord[k]; memSecrets["dc." + k] = val; }
}
// one-time: anything saved in plain text before gets encrypted (or dropped from the file if it can't be)
function secretsTidy() {
  let changed = false;
  for (const k of ["clientSecret", "accessToken", "refreshToken"]) {
    const v = settings.discord && settings.discord[k];
    if (v && !String(v).startsWith("enc:")) { dcPutSecret(k, String(v)); changed = true; }
  }
  const op = settings.obs && settings.obs.pass;
  if (op && !String(op).startsWith("enc:")) { const e = encSecret(String(op)); if (e) settings.obs.pass = e; else { memSecrets["obs.pass"] = String(op); delete settings.obs.pass; } changed = true; }
  if (changed) saveSettings();
}
const dcConfigured = () => !!(dcCfg().clientId && dcGetSecret("clientSecret"));

function dcState() {
  const ch = dc.channel;
  return {
    status: dc.status, err: dc.err, configured: dcConfigured(), secretLen: dcGetSecret("clientSecret").length, clientId: dcCfg().clientId || "", vs: dc.vs,
    channel: ch ? { id: ch.id, guildId: ch.guildId, since: ch.since, name: ch.name, guild: ch.guild, members: [...ch.members.values()].map(x => Object.assign({}, x, { speaking: dc.speaking.has(x.id) })) } : null
  };
}
function dcPush() {
  if (dc.pushT) return;
  dc.pushT = setTimeout(() => { dc.pushT = null; if (win && !win.isDestroyed()) win.webContents.send("dc:state", dcState()); try { voUpdate(); } catch {} }, 60);
}
// Small log of what Sothis tells Discord about your status (Roaming\Sothis\discord-status-log.txt)
function presLog(line) {
  try {
    const f = path.join(DATA_DIR, "discord-status-log.txt");
    let old = ""; try { old = fs.readFileSync(f, "utf8"); } catch {}
    const lines = (old + new Date().toISOString().slice(11, 19) + "  " + line + "\n").split("\n").slice(-200);
    fs.writeFileSync(f, lines.join("\n"));
  } catch {}
}
function dcSet(st, err) { const was = dc.status; if (was !== st) presLog("connection: " + st + (err ? " (" + err + ")" : "")); dc.status = st; if (err !== undefined) dc.err = err; else if (st === "ok") dc.err = ""; dcPush(); if ((was === "ok") !== (st === "ok")) { try { refreshTray(); setThumbar(); } catch {} } }

function dcSend(op, obj) {
  if (!dc.sock) return;
  const j = Buffer.from(JSON.stringify(obj)), h = Buffer.alloc(8);
  h.writeInt32LE(op, 0); h.writeInt32LE(j.length, 4);
  dc.sock.write(Buffer.concat([h, j]));
}
function dcCmd(cmd, args, evt) {
  return new Promise((res, rej) => {
    if (!dc.sock) return rej(new Error("Not connected"));
    const nonce = String(++dc.nonce);
    dc.pending.set(nonce, { res, rej });
    dcSend(1, { cmd, args, evt, nonce });
    setTimeout(() => { if (dc.pending.delete(nonce)) rej(new Error("Discord didn't answer")); }, cmd === "AUTHORIZE" ? 180000 : 10000);
  });
}
function dcData(chunk) {
  dc.buf = Buffer.concat([dc.buf, chunk]);
  while (dc.buf.length >= 8) {
    const op = dc.buf.readInt32LE(0), len = dc.buf.readInt32LE(4);
    if (dc.buf.length < 8 + len) break;
    const body = dc.buf.subarray(8, 8 + len);
    dc.buf = dc.buf.subarray(8 + len);
    let msg; try { msg = JSON.parse(body.toString("utf8")); } catch { continue; }
    if (op === 2) { dcClose(msg.message || "Discord closed the connection"); return; }
    if (op === 3) { dcSend(4, msg); continue; }
    if (msg.nonce && dc.pending.has(msg.nonce)) {
      const p = dc.pending.get(msg.nonce); dc.pending.delete(msg.nonce);
      if (msg.evt === "ERROR") p.rej(Object.assign(new Error((msg.data && msg.data.message) || "Discord error"), { code: msg.data && msg.data.code }));
      else p.res(msg.data);
    } else if (msg.cmd === "DISPATCH") dcEvent(msg.evt, msg.data || {});
  }
}
function dcConnect() {
  clearTimeout(dc.retry);
  if (dc.sock) return;
  if (!dcConfigured() || dcCfg().enabled === false) { dcSet(dcConfigured() ? "off" : "nosetup"); return; }
  dcSet("connecting");
  dcTry(0);
}
function dcTry(i) {
  if (i > 9) { dcSet("nodiscord"); dc.retry = setTimeout(dcConnect, 15000); return; }
  const sock = net.createConnection(`\\\\?\\pipe\\discord-ipc-${i}`);
  let opened = false;
  sock.once("connect", () => {
    opened = true; dc.sock = sock; dc.buf = Buffer.alloc(0);
    sock.on("data", dcData);
    dcSend(0, { v: 1, client_id: dcCfg().clientId });
  });
  sock.on("error", () => { if (!opened) { sock.destroy(); dcTry(i + 1); } });
  sock.on("close", () => { if (opened && dc.sock === sock) dcClose(); });
}
function dcClose(reason, stay) {
  const s = dc.sock; dc.sock = null;
  if (s) { try { s.destroy(); } catch {} }
  dc.channel = null; dc.subChan = null; dc.speaking.clear(); dc.vs = null;
  for (const p of dc.pending.values()) p.rej(new Error("closed"));
  dc.pending.clear();
  if (stay) return dcPush();
  if (dc.status === "off" || dc.status === "error") return dcPush();
  dcSet("nodiscord", reason || "");
  clearTimeout(dc.retry); dc.retry = setTimeout(dcConnect, 15000);
}
async function dcToken(params) {
  const body = new URLSearchParams(Object.assign({ client_id: dcCfg().clientId, client_secret: dcGetSecret("clientSecret") }, params));
  const r = await fetch("https://discord.com/api/oauth2/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(j.error === "invalid_client" ? "Discord says the Client Secret is wrong." : (j.error_description || j.error || "Discord sign-in failed (" + r.status + ")"));
  dcPutSecret("accessToken", j.access_token);
  if (j.refresh_token) dcPutSecret("refreshToken", j.refresh_token);
  settings.discord.expiresAt = Date.now() + (j.expires_in || 604800) * 1000;
  saveSettings();
  return j.access_token;
}
const dcRefresh = () => dcGetSecret("refreshToken") ? dcToken({ grant_type: "refresh_token", refresh_token: dcGetSecret("refreshToken") }) : Promise.reject(new Error("no token"));
async function dcAuth() {
  dcSet("auth");
  let tok = dcGetSecret("accessToken");
  if (tok && Date.now() > (dcCfg().expiresAt || 0) - 60000) tok = await dcRefresh().catch(() => "");
  for (const attempt of [0, 1]) {
    if (!tok) break;
    try {
      const au = await dcCmd("AUTHENTICATE", { access_token: tok });
      if (au && Array.isArray(au.scopes) && !DC_BASE.every(s => au.scopes.includes(s))) { tok = ""; break; }   // missing core permissions
      return dcReady();
    }
    catch { tok = attempt === 0 ? await dcRefresh().catch(() => "") : ""; }
  }
  // First time (or the saved sign-in expired): Discord shows its own "Authorize" pop-up.
  dcSet("approve");
  let a;
  try { a = await dcCmd("AUTHORIZE", { client_id: dcCfg().clientId, scopes: DC_SCOPES }); }
  catch (e) {
    if (e.code === 5000) throw e;                       // you clicked Cancel
    a = await dcCmd("AUTHORIZE", { client_id: dcCfg().clientId, scopes: DC_BASE });   // try again without mentions
  }
  dcSet("auth");
  tok = await dcToken({ grant_type: "authorization_code", code: a.code, redirect_uri: "http://localhost" });
  await dcCmd("AUTHENTICATE", { access_token: tok });
  return dcReady();
}
async function dcReady() {
  dcSet("ok");
  await dcCmd("SUBSCRIBE", {}, "VOICE_CHANNEL_SELECT").catch(() => {});
  await dcCmd("SUBSCRIBE", {}, "VOICE_SETTINGS_UPDATE").catch(() => {});
  await dcCmd("SUBSCRIBE", {}, "NOTIFICATION_CREATE").catch(() => {});
  dcCmd("GET_VOICE_SETTINGS", {}).then(v => { dc.vs = { mute: !!v.mute, deaf: !!v.deaf }; dcPush(); }).catch(() => {});
  dcApplyChannel(await dcCmd("GET_SELECTED_VOICE_CHANNEL", {}).catch(() => null));
  dcPresKey = ""; dcPresence();
}
function dcUpsert(v) {
  if (!dc.channel || !v || !v.user) return;
  const u = v.user, s = v.voice_state || {};
  let avatar;
  if (u.avatar) avatar = `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64`;
  else { let n = 0; try { n = Number((BigInt(u.id) >> 22n) % 6n); } catch {} avatar = `https://cdn.discordapp.com/embed/avatars/${n}.png`; }
  dc.channel.members.set(u.id, {
    id: u.id, name: v.nick || u.global_name || u.username || "Someone", avatar,
    muted: !!(s.mute || s.self_mute || s.suppress), deaf: !!(s.deaf || s.self_deaf), me: !!(dc.user && u.id === dc.user.id),
    vol: typeof v.volume === "number" ? Math.round(v.volume) : 100, localMute: !!v.mute,
    live: !!(s.self_stream || v.self_stream || v.streaming), cam: !!(s.self_video || v.self_video)
  });
  // keep one example of what Discord sends, to check which fields it includes (local file only)
  if (!dc.sampled) { dc.sampled = true; try { fs.writeFileSync(path.join(DATA_DIR, "discord-voice-sample.json"), JSON.stringify({ keys: Object.keys(v), voice_state: Object.keys(s) }, null, 1)); } catch {} }
}
async function dcApplyChannel(ch) {
  const old = dc.subChan;
  if (old && (!ch || ch.id !== old)) for (const e of DC_CH_EVTS) dcCmd("UNSUBSCRIBE", { channel_id: old }, e).catch(() => {});
  dc.speaking.clear();
  if (!ch || !ch.id) { dc.channel = null; dc.subChan = null; return dcPush(); }
  let guild = "";
  if (ch.guild_id) {
    guild = dc.guildNames[ch.guild_id] || "";
    if (!guild) { const g = await dcCmd("GET_GUILD", { guild_id: ch.guild_id }).catch(() => null); guild = (g && g.name) || ""; if (guild) dc.guildNames[ch.guild_id] = guild; }
  }
  const since = dc.channel && dc.channel.id === ch.id ? dc.channel.since : Date.now();
  dc.channel = { id: ch.id, guildId: ch.guild_id || "", name: ch.name || (ch.guild_id ? "Voice" : "Call"), guild: guild || (ch.guild_id ? "" : "Direct call"), since, members: new Map() };
  for (const v of ch.voice_states || []) dcUpsert(v);
  if (old !== ch.id) { dc.subChan = ch.id; for (const e of DC_CH_EVTS) dcCmd("SUBSCRIBE", { channel_id: ch.id }, e).catch(() => {}); }
  dcPush();
}
function dcEvent(evt, d) {
  if (evt === "READY") { dc.user = d.user || null; dcAuth().catch(e => dcSet("error", e.code === 5000 ? "You chose not to allow Sothis in Discord." : e.message)); return; }
  if (evt === "VOICE_CHANNEL_SELECT") {
    if (!d.channel_id) return dcApplyChannel(null);
    dcCmd("GET_CHANNEL", { channel_id: d.channel_id }).then(dcApplyChannel).catch(() => dcApplyChannel(null));
    return;
  }
  if (evt === "VOICE_STATE_CREATE" || evt === "VOICE_STATE_UPDATE") { dcUpsert(d); return dcPush(); }
  if (evt === "VOICE_STATE_DELETE") { if (dc.channel && d.user) { dc.channel.members.delete(d.user.id); dc.speaking.delete(d.user.id); } return dcPush(); }
  if (evt === "SPEAKING_START") { dc.speaking.add(d.user_id); return dcPush(); }
  if (evt === "SPEAKING_STOP") { dc.speaking.delete(d.user_id); return dcPush(); }
  if (evt === "VOICE_SETTINGS_UPDATE") { dc.vs = { mute: !!d.mute, deaf: !!d.deaf }; refreshTray(); setThumbar(); return dcPush(); }
  if (evt === "NOTIFICATION_CREATE") {
    // Shown inside Sothis only (never as a Windows pop-up)
    const msg = d.message || {}, a = msg.author || {};
    let icon = d.icon_url || "";
    if (!icon && a.id && a.avatar) icon = `https://cdn.discordapp.com/avatars/${a.id}/${a.avatar}.png?size=64`;
    if (win && !win.isDestroyed()) win.webContents.send("dc:notify", { title: d.title || a.global_name || a.username || "Discord", body: d.body || msg.content || "", icon });
  }
}
ipcMain.handle("dc:get", () => dcState());
ipcMain.handle("dc:save", (_e, { clientId, clientSecret }) => {
  settings.discord = settings.discord || {};
  const id = String(clientId || "").trim().replace(/\D/g, "");
  const changed = id !== settings.discord.clientId || (clientSecret && clientSecret !== dcGetSecret("clientSecret"));
  settings.discord.clientId = id;
  if (clientSecret) dcPutSecret("clientSecret", String(clientSecret).trim());
  if (changed) { dcPutSecret("accessToken", ""); dcPutSecret("refreshToken", ""); delete settings.discord.expiresAt; }
  settings.discord.enabled = true;
  saveSettings();
  dc.status = "connecting"; dcClose(null, true); dcConnect();
  return dcState();
});
ipcMain.handle("dc:off", () => {
  settings.discord = settings.discord || {}; settings.discord.enabled = false; saveSettings();
  clearTimeout(dc.retry); dc.status = "off"; dcClose(null, true); dcSet("off", "");
  return dcState();
});
ipcMain.handle("dc:userVol", async (_e, { id, vol }) => {
  if (dc.status !== "ok" || !id) return dcState();
  const v = Math.max(0, Math.min(200, Math.round(Number(vol) || 0)));
  try { await dcCmd("SET_USER_VOICE_SETTINGS", { user_id: id, volume: v }); if (dc.channel && dc.channel.members.has(id)) dc.channel.members.get(id).vol = v; dcPush(); } catch {}
  return dcState();
});
ipcMain.handle("dc:openCall", () => {
  const ch = dc.channel;
  const url = ch ? `discord://-/channels/${ch.guildId || "@me"}/${ch.id}` : "discord://";
  shell.openExternal(url).catch(() => {});
  return true;
});
ipcMain.handle("dc:join", async (_e, id) => {
  if (dc.status !== "ok") return { ok: false, err: "Discord isn't connected" };
  try { await dcCmd("SELECT_VOICE_CHANNEL", { channel_id: id || null, force: true }); return { ok: true }; }
  catch (e) { return { ok: false, err: e.message }; }
});
ipcMain.handle("dc:voice", async (_e, what) => {
  if (dc.status !== "ok") return dcState();
  const cur = dc.vs || { mute: false, deaf: false };
  const args = what === "deaf" ? { deaf: !cur.deaf } : { mute: !cur.mute };
  try { const v = await dcCmd("SET_VOICE_SETTINGS", args); dc.vs = { mute: !!v.mute, deaf: !!v.deaf }; dcPush(); refreshTray(); setThumbar(); } catch {}
  return dcState();
});
async function dcToggle(what) {
  if (dc.status !== "ok") return;
  const cur = dc.vs || { mute: false, deaf: false };
  try { const v = await dcCmd("SET_VOICE_SETTINGS", what === "deaf" ? { deaf: !cur.deaf } : { mute: !cur.mute }); dc.vs = { mute: !!v.mute, deaf: !!v.deaf }; dcPush(); refreshTray(); setThumbar(); } catch {}
}

/* ---------- Discord extras: mute for me, channel browser, audio settings, status ---------- */
ipcMain.handle("dc:userMute", async (_e, { id, mute }) => {
  if (dc.status !== "ok" || !id) return Object.assign(dcState(), { action: { ok: false, error: "Discord isn't connected." } });
  try {
    await dcCmd("SET_USER_VOICE_SETTINGS", { user_id: String(id), mute: !!mute });
    if (dc.channel && dc.channel.members.has(id)) dc.channel.members.get(id).localMute = !!mute;
    dcPush();
    return Object.assign(dcState(), { action: { ok: true } });
  } catch (e) {
    return Object.assign(dcState(), { action: { ok: false, error: String((e && e.message) || "Discord rejected the change.").slice(0, 120) } });
  }
});
const dcAvatar = u => {
  if (u && u.avatar) return `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64`;
  let n = 0; try { n = Number((BigInt(u.id) >> 22n) % 6n); } catch {}
  return `https://cdn.discordapp.com/embed/avatars/${n}.png`;
};
ipcMain.handle("dc:guilds", async () => {
  if (dc.status !== "ok") return { ok: false, guilds: [] };
  try {
    const r = await dcCmd("GET_GUILDS", {});
    const guilds = (r && r.guilds || []).map(g => ({ id: g.id, name: g.name, icon: g.icon_url || "" }));
    guilds.forEach(g => { dc.guildNames[g.id] = g.name; });
    return { ok: true, guilds };
  } catch (e) { return { ok: false, guilds: [], err: e.message }; }
});
ipcMain.handle("dc:channels", async (_e, guildId) => {
  if (dc.status !== "ok" || !guildId) return { ok: false, channels: [] };
  try {
    const r = await dcCmd("GET_CHANNELS", { guild_id: guildId });
    const voice = (r && r.channels || []).filter(c => c.type === 2 || c.type === 13).slice(0, 25);
    const full = await Promise.all(voice.map(c => dcCmd("GET_CHANNEL", { channel_id: c.id }).catch(() => null)));
    const channels = voice.map((c, i) => {
      const f = full[i] || {};
      return {
        id: c.id, name: f.name || c.name, pos: typeof f.position === "number" ? f.position : i,
        members: (f.voice_states || []).map(v => ({ id: v.user && v.user.id, name: v.nick || (v.user && (v.user.global_name || v.user.username)) || "Someone", avatar: v.user ? dcAvatar(v.user) : "" }))
      };
    }).sort((a, b) => a.pos - b.pos);
    return { ok: true, channels, here: dc.channel ? dc.channel.id : "" };
  } catch (e) { return { ok: false, channels: [], err: e.message }; }
});
const dcAudioOut = v => ({
  input: { device: v.input && v.input.device_id, volume: v.input ? Math.round(v.input.volume) : 100, devices: (v.input && v.input.available_devices || []).map(d => ({ id: d.id, name: d.name })) },
  output: { device: v.output && v.output.device_id, volume: v.output ? Math.round(v.output.volume) : 100, devices: (v.output && v.output.available_devices || []).map(d => ({ id: d.id, name: d.name })) },
  mode: v.mode ? v.mode.type : "VOICE_ACTIVITY",
  noise: !!v.noise_suppression, echo: !!v.echo_cancellation, agc: !!v.automatic_gain_control
});
ipcMain.handle("dc:audioGet", async () => {
  if (dc.status !== "ok") return null;
  try { return dcAudioOut(await dcCmd("GET_VOICE_SETTINGS", {})); } catch { return null; }
});
ipcMain.handle("dc:audioSet", async (_e, patch) => {
  if (dc.status !== "ok" || !patch) return null;
  const a = {};
  if (patch.inputDevice) a.input = { device_id: String(patch.inputDevice) };
  if (typeof patch.inputVolume === "number") a.input = Object.assign(a.input || {}, { volume: Math.max(0, Math.min(100, patch.inputVolume)) });
  if (patch.outputDevice) a.output = { device_id: String(patch.outputDevice) };
  if (typeof patch.outputVolume === "number") a.output = Object.assign(a.output || {}, { volume: Math.max(0, Math.min(200, patch.outputVolume)) });
  if (patch.mode === "VOICE_ACTIVITY" || patch.mode === "PUSH_TO_TALK") a.mode = { type: patch.mode };
  if (typeof patch.noise === "boolean") a.noise_suppression = patch.noise;
  if (typeof patch.echo === "boolean") a.echo_cancellation = patch.echo;
  if (typeof patch.agc === "boolean") a.automatic_gain_control = patch.agc;
  try { return dcAudioOut(await dcCmd("SET_VOICE_SETTINGS", a)); } catch (e) { return { error: e.message }; }
});

// Discord status: "Listening to <song>" while music plays, or your Siege rank while Siege is open
let dcPresKey = "", dcPresT = null, dcPresSongAt = 0, dcIdleAt = 0;
const dcPresOn = () => settings.dcPresence !== false;
function dcPresence() {
  clearTimeout(dcPresT);
  dcPresT = setTimeout(dcPresenceNow, 1500);   // Discord only allows a few status changes a minute
}
// What you're playing right now: Steam tells us its running game; others are spotted by their program name.
const GAME_EXES = {
  "overwatch.exe": "Overwatch 2", "rainbowsix.exe": "Rainbow Six Siege", "rainbowsix_vulkan.exe": "Rainbow Six Siege", "rainbowsix_be.exe": "Rainbow Six Siege",
  "cs2.exe": "Counter-Strike 2", "valorant-win64-shipping.exe": "VALORANT", "fortniteclient-win64-shipping.exe": "Fortnite",
  "marvel-win64-shipping.exe": "Marvel Rivals", "robloxplayerbeta.exe": "Roblox", "osu!.exe": "osu!", "league of legends.exe": "League of Legends",
  "palworld-win64-shipping.exe": "Palworld", "eldenring.exe": "Elden Ring", "witcher3.exe": "The Witcher 3", "skyrimse.exe": "Skyrim",
  "fallout4.exe": "Fallout 4", "minecraft.exe": "Minecraft", "azahar.exe": "Nintendo 3DS (Azahar)", "eden.exe": "Nintendo Switch (Eden)",
  "fragpunk.exe": "FragPunk", "tslgame.exe": "PUBG", "gtav.exe": "GTA V", "gta5.exe": "GTA V", "rdr2.exe": "Red Dead Redemption 2",
  "hytale.exe": "Hytale", "7daystodie.exe": "7 Days to Die", "vampiresurvivors.exe": "Vampire Survivors", "anno117.exe": "Anno 117"
};
let dcGame = null, dcGameAt = 0, dcSwitchOn = false, r6MapNow = null, csLive = null, owMapNow = null, owPhase = null, owRankSeenAt = 0, owHero = null, owHudSaved = false;
ipcMain.on("game:ranks", (_e, r) => {
  // a rank just read off the game screen is newer than the (cached) online profile for a while
  if (r && r.ow && owRankSeenAt && Date.now() - owRankSeenAt < 45 * 60000) r = Object.assign({}, r, { ow: undefined });
  if (r && r.owRoles && typeof r.owRoles === "object") {
    const keep = (settings.owRolesSeen && Date.now() - settings.owRolesSeen.at < 45 * 60000) ? settings.owRolesSeen.role : "";
    const next = {};
    for (const k of ["Tank", "Damage", "Support"]) if (typeof r.owRoles[k] === "string") next[k] = r.owRoles[k].slice(0, 30);
    if (keep && settings.owRoles && settings.owRoles[keep]) next[keep] = settings.owRoles[keep];   // a rank just read off the screen wins for a while
    settings.owRoles = next;
  }
  settings.gameRanks = Object.assign({}, settings.gameRanks, Object.fromEntries(Object.entries(r || {}).filter(([k, v]) => ["ow", "cs"].includes(k) && typeof v === "string").map(([k, v]) => [k, v.slice(0, 60)])));
  saveSettings(); dcPresence();
});
// CS2 tells Sothis the live map and score (Game State Integration) once a small config file is in its cfg folder
const CS_GSI_PORT = 3871;
const CS_MAPS = { de_dust2: "Dust II", de_mirage: "Mirage", de_inferno: "Inferno", de_nuke: "Nuke", de_overpass: "Overpass", de_ancient: "Ancient", de_anubis: "Anubis", de_vertigo: "Vertigo", de_train: "Train", cs_office: "Office", cs_italy: "Italy" };
function csGsiServer() {
  try {
    require("http").createServer((req, res) => {
      let body = "";
      req.on("data", c => { body += c; if (body.length > 1e6) req.destroy(); });
      req.on("end", () => {
        res.end("ok");
        let j = null; try { j = JSON.parse(body); } catch { return; }
        const m = j && j.map;
        if (!m || !m.name) { csLive = null; dcPresence(); return; }
        const nm = CS_MAPS[m.name] || String(m.name).replace(/^(de|cs|ar)_/, "").replace(/_/g, " ").replace(/\b\w/g, x => x.toUpperCase());
        const ct = m.team_ct && m.team_ct.score, t = m.team_t && m.team_t.score;
        const side = j.player && j.player.team, mine = side === "CT" ? ct : t, theirs = side === "CT" ? t : ct;
        const score = typeof ct === "number" ? (side ? `${mine}–${theirs}` : `${ct}–${t}`) : "";
        const me = !j.provider || !j.player || !j.player.steamid || j.player.steamid === j.provider.steamid;   // not while spectating someone
        const next = { map: nm, raw: String(m.name), score, side: me && (side === "CT" || side === "T") ? side : "", at: Date.now() };
        const changed = !csLive || csLive.map !== next.map || csLive.score !== next.score || csLive.side !== next.side;
        csLive = next; if (changed) dcPresence();
      });
    }).on("error", () => {}).listen(CS_GSI_PORT, "127.0.0.1");
  } catch {}
}
async function csGsiInstall() {
  try {
    let root = await regQuery("HKCU\\Software\\Valve\\Steam", "SteamPath");
    if (!root) return;
    root = root.replace(/\//g, "\\");
    const libs = new Set([path.join(root, "steamapps")]);
    try { const vdf = fs.readFileSync(path.join(root, "steamapps", "libraryfolders.vdf"), "utf8"); for (const mm of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libs.add(path.join(mm[1].replace(/\\\\/g, "\\"), "steamapps")); } catch {}
    for (const lib of libs) {
      const cfg = path.join(lib, "common", "Counter-Strike Global Offensive", "game", "csgo", "cfg");
      if (!fs.existsSync(cfg)) continue;
      const file = path.join(cfg, "gamestate_integration_sothis.cfg");
      const txt = `"Sothis"\n{\n  "uri" "http://127.0.0.1:${CS_GSI_PORT}/cs2"\n  "timeout" "1.0"\n  "buffer" "0.5"\n  "throttle" "2.0"\n  "heartbeat" "30.0"\n  "data"\n  {\n    "provider" "1"\n    "map" "1"\n    "player_id" "1"\n  }\n}\n`;
      let cur = ""; try { cur = fs.readFileSync(file, "utf8"); } catch {}
      if (cur !== txt) fs.writeFileSync(file, txt);
    }
  } catch {}
}
const GAME_IMG = {
  "Rainbow Six Siege": () => settings.r6RankImg || "",
};
// the .exe names inside a Steam game's install folder (null if the folder can't be found)
const steamExeCache = {};
async function steamAppExes(sid) {
  if (steamExeCache[sid] && Date.now() - steamExeCache[sid].at < 3600000) return steamExeCache[sid].set;
  let set = null;
  try {
    let root = await regQuery("HKCU\\Software\\Valve\\Steam", "SteamPath");
    if (root) {
      root = root.replace(/\//g, "\\");
      const libs = new Set([path.join(root, "steamapps")]);
      try { const vdf = fs.readFileSync(path.join(root, "steamapps", "libraryfolders.vdf"), "utf8"); for (const mm of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libs.add(path.join(mm[1].replace(/\\\\/g, "\\"), "steamapps")); } catch {}
      for (const lib of libs) {
        let acf = ""; try { acf = fs.readFileSync(path.join(lib, "appmanifest_" + sid + ".acf"), "utf8"); } catch { continue; }
        const dir = (acf.match(/"installdir"\s+"([^"]+)"/) || [])[1]; if (!dir) continue;
        const top = path.join(lib, "common", dir); if (!fs.existsSync(top)) continue;
        set = new Set();
        const walk = (d, depth) => { let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
          for (const e of ents) { if (e.isDirectory()) { if (depth < 5) walk(path.join(d, e.name), depth + 1); } else if (/\.exe$/i.test(e.name) && !/^(unins|crashreport|unitycrash|ue4prereq|vc_?redist|dxsetup|setup|easyanticheat_setup)/i.test(e.name)) set.add(e.name.toLowerCase()); } };
        walk(top, 0);
        if (!set.size) set = null;
        break;
      }
    }
  } catch {}
  steamExeCache[sid] = { set, at: Date.now() };
  return set;
}
async function dcGameNow() {
  // Switch tab in Sothis counts as playing your Switch
  if (dcSwitchOn || (typeof swPopWin !== "undefined" && swPopWin && !swPopWin.isDestroyed())) return { name: "Nintendo Switch", img: "" };
  if (typeof emuGame !== "undefined" && emuGame) return emuGame;
  // Steam's currently running game
  let sid = await new Promise(res => execFile("reg", ["query", "HKCU\\Software\\Valve\\Steam", "/v", "RunningAppID"], { windowsHide: true, timeout: 4000 },
    (err, out) => { const m = !err && String(out).match(/RunningAppID\s+REG_DWORD\s+0x([0-9a-f]+)/i); res(m ? parseInt(m[1], 16) : 0); }));
  if (sid) { const r = await regQuery(`HKCU\\Software\\Valve\\Steam\\Apps\\${sid}`, "Running"); if (r != null && !/^(0x0*1|1)$/i.test(r)) sid = 0; }
  const run = await runningSet();
  for (const [exe, name] of Object.entries(GAME_EXES)) if (run.has(exe)) return { name, exe, img: GAME_IMG[name] ? GAME_IMG[name]() : "" };
  // Steam can leave RunningAppID set after a game closes: only trust it while one of the game's own programs is running
  if (sid) { const exes = await steamAppExes(sid); if (exes && ![...exes].some(e => run.has(e))) sid = 0; }
  if (sid) {
    let g = (gamesCache || []).find(x => x.key === "steam:" + sid);
    if (!g) { try { g = (await steamGames()).find(x => x.key === "steam:" + sid); } catch {} }
    return { name: g ? g.name : "a Steam game", sid, img: `https://cdn.cloudflare.steamstatic.com/steam/apps/${sid}/header.jpg` };
  }
  if (run.has("javaw.exe") && [...run].some(p => /minecraft|modrinth|curseforge|lunar/i.test(p))) return { name: "Minecraft", img: "" };
  return null;
}
// Map pictures: Siege from stats.cc, Overwatch from OverFast, CS2 from a public map-image set
let owMapList = null, owMapListAt = 0;
async function owMapImg(name) {
  try {
    if (!owMapList || Date.now() - owMapListAt > 24 * 3600 * 1000) {
      const r = await owFetch("/maps");
      if (Array.isArray(r.json)) { owMapList = r.json; owMapListAt = Date.now(); }
    }
    const want = normTxt(name);
    const m = (owMapList || []).find(x => normTxt(x.name) === want) || (owMapList || []).find(x => normTxt(x.name).includes(want) || want.includes(normTxt(x.name)));
    return m && /^https:\/\//.test(m.screenshot || "") ? m.screenshot : "";
  } catch { return ""; }
}
// Game logos for Discord: the same square game icons Discord itself shows (its public list of detectable games)
let gameIcons = null, gameIconsLoading = null;
const gameLogoCache = {};
function gameIconsLoad() {
  if (gameIcons || gameIconsLoading) return gameIconsLoading || Promise.resolve();
  const file = path.join(DATA_DIR, "game-icons.json");
  gameIconsLoading = (async () => {
    let cached = null; try { cached = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
    if (cached && Array.isArray(cached.list) && cached.list.length && Date.now() - (cached.at || 0) < 7 * 864e5) { gameIcons = cached.list; return; }
    try {
      const { net: enet } = require("electron");
      const r = await enet.fetch("https://discord.com/api/v9/applications/detectable");
      if (!r.ok) throw new Error("HTTP " + r.status);
      const all = await r.json(), list = [];
      for (const a of Array.isArray(all) ? all : []) {
        const ic = a && (a.icon || a.icon_hash); if (!a || !a.id || !ic) continue;
        list.push({
          u: `https://cdn.discordapp.com/app-icons/${a.id}/${ic}.png?size=512`,
          n: [a.name, ...(Array.isArray(a.aliases) ? a.aliases : [])].map(normTxt).filter(x => x.length > 3),
          e: (Array.isArray(a.executables) ? a.executables : []).filter(x => x && (!x.os || x.os === "win32")).map(x => String(x.name || "").toLowerCase().split(/[\\/]/).pop()).filter(Boolean),
          s: (Array.isArray(a.third_party_skus) ? a.third_party_skus : []).filter(x => x && x.distributor === "steam").map(x => String(x.id)),
        });
      }
      if (list.length < 100) throw new Error("only " + list.length + " games");
      gameIcons = list; for (const k in gameLogoCache) delete gameLogoCache[k];
      try { fs.writeFileSync(file, JSON.stringify({ at: Date.now(), list })); } catch {}
      presLog("game logos: loaded " + list.length);
    } catch (e) {
      presLog("game logos: couldn't load (" + (e && e.message) + ")");
      gameIcons = cached && Array.isArray(cached.list) ? cached.list : [];
      if (!gameIcons.length) setTimeout(() => { gameIcons = null; gameIconsLoading = null; }, 30 * 60000);
    }
  })();
  return gameIconsLoading;
}
function gameLogo(game) {
  if (!game || !game.name) return "";
  if (!gameIcons) { gameIconsLoad().then(() => { if (gameIcons && gameIcons.length) dcPresence(); }); return game.img || ""; }
  const key = game.name + "|" + (game.exe || "") + "|" + (game.sid || "");
  if (gameLogoCache[key] === undefined) {
    const sid = String(game.sid || STEAM_IDS[game.name] || ""), exe = String(game.exe || "").toLowerCase(), n = normTxt(game.name);
    const hit = (sid && gameIcons.find(x => x.s && x.s.includes(sid)))
      || (exe && gameIcons.find(x => x.e && x.e.includes(exe)))
      || gameIcons.find(x => x.n.includes(n))
      || (n.length > 6 && gameIcons.find(x => x.n.some(m => m.includes(n))));
    gameLogoCache[key] = hit ? hit.u : "";
    presLog("game logo for " + game.name + ": " + (hit ? hit.u : "none found, using the store picture"));
  }
  // Discord shows its own CDN's icons as a "?" when linked straight, so they go through images.weserv.nl as a plain PNG
  const u = gameLogoCache[key];
  return u ? "https://images.weserv.nl/?url=" + encodeURIComponent(u.replace(/^https:\/\//, "")) + "&w=512&h=512&fit=contain&output=png" : (game.img || "");
}
// CS2: a T and a CT head (SkinRave's bot pictures), as PNGs via images.weserv.nl
const CS_SIDE_HEAD = {
  T: "https://images.weserv.nl/?url=static.skinrave.gg/skinrave-front-assets/public/Bot-Rave.webp&w=256&h=256&output=png",
  CT: "https://images.weserv.nl/?url=static.skinrave.gg/skinrave-front-assets/public/Bot-Kiwi.webp&w=256&h=256&output=png",
};
// Siege: operator icons (r6operators on jsDelivr is SVG; images.weserv.nl turns it into a PNG Discord can show)
let r6Op = null, r6OpSaved = false, r6ShotsUntil = 0, r6ShotN = 0;
const r6OpSlug = name => String(name || "").toLowerCase().replace(/ø/g, "o").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
const r6OpIcon = slug => "https://images.weserv.nl/?url=" + encodeURIComponent("cdn.jsdelivr.net/npm/r6operators/dist/icons/" + slug + ".svg") + "&w=256&h=256&fit=contain&output=png";
function mapPicture(game) {
  if (game === "Rainbow Six Siege" && r6MapNow && /^[a-z0-9-]+$/.test(r6MapNow.slug || "")) return `https://static.stats.cc/siege/maps/${r6MapNow.slug}_thumbnail.webp`;
  if (game === "Counter-Strike 2" && csLive && /^[a-z0-9_]+$/.test(csLive.raw || "")) return `https://raw.githubusercontent.com/ghostcap-gaming/cs2-map-images/main/cs2/${csLive.raw}.png`;
  if (game === "Overwatch 2" && owMapNow && owMapNow.img) return owMapNow.img;
  return "";
}
function dcPresenceNow() {
  if (!dc.sock || dc.status !== "ok") { presLog("not sent: Discord connection is " + (dc.status || "off")); return; }
  let act = null;
  const song = dcPresOn() && player.connected && player.playing && player.title ? { t: String(player.title), a: String(player.artist || "") } : null;
  let game = dcPresOn() ? dcGame : null;
  const gr = settings.gameRanks || {};
  let rank = "", map = "", small = null;   // small: the little picture (your hero / operator / side) instead of the game logo
  if (game && game.name === "Rainbow Six Siege") {
    rank = settings.r6RankName ? String(settings.r6RankName).replace(/^(no rank|not ranked)$/i, "Unranked") + (settings.r6RP ? " · " + Number(settings.r6RP).toLocaleString("en-US") + " RP" : "") : "";
    if (r6MapNow && Date.now() - r6MapNow.at < 45 * 60000) map = r6MapNow.name;
    if (map && r6Op && Date.now() - r6Op.at < 15 * 60000) small = { img: r6OpIcon(r6Op.slug), text: r6Op.name + (rank ? " · " + rank : "") };
  } else if (game && game.name === "Counter-Strike 2") {
    rank = gr.cs || "";
    if (csLive && Date.now() - csLive.at < 90000 && csLive.map) {
      map = csLive.map + (csLive.side ? " · " + csLive.side + " side" : "") + (csLive.score ? " · " + csLive.score : "");
      if (csLive.side) small = { img: CS_SIDE_HEAD[csLive.side], text: (csLive.side === "CT" ? "Counter-Terrorist" : "Terrorist") + " side" + (rank ? " · " + rank : "") };
    }
  } else if (game && /^wardogs\b/i.test(game.name)) {
    // just the team's logo (small picture), no team name in the text
    const lg = WD_LOGO[String(settings.wdTeam || "").toUpperCase()];
    if (lg) small = { img: lg, text: wdTeamName() };
    if (wdCash && Date.now() - wdCash.at < 10 * 60000) rank = wdCash.txt;   // up or down this match
  } else if (game && game.name === "Overwatch 2") {
    const ph = owPhase && Date.now() - owPhase.at < 20 * 60000 ? owPhase.kind : "";
    rank = owRankNow();
    if (owHero && ph !== "menu" && ph !== "queue") {
      rank = owHero.name + (rank ? " · " + rank : "");
      const h = (owHeroes || []).find(x => x.name === owHero.name);
      if (h && /^https:\/\//.test(h.portrait || "")) small = { img: h.portrait, text: rank };
    }
    if (ph === "menu") map = "In the main menu";
    else if (ph === "queue") map = "In queue";
    else if (owMapNow && Date.now() - owMapNow.at < 45 * 60000) map = owMapNow.name + (owMapNow.mode ? " · " + owMapNow.mode : "");
  }
  const art = /^https:\/\//.test(player.art || "") ? player.art : "";
  // on a map: the map's picture big and the game's logo small; anywhere else (menus, queue): just the game's logo
  const onMap = !!map && !/^In (the main menu|queue)$/.test(map);
  const mapImg = onMap && game ? mapPicture(game.name) : "";
  const logo = game ? gameLogo(game) : "";
  const mapName = map ? map.split(" · ")[0] : "";
  // the timer on Discord counts the current match (a new map, or a Wardogs match with cash on screen); in menus it counts the whole game
  const realMap = map && !/^In (the main menu|queue)$/.test(map) && !(game && /^wardogs\b/i.test(game.name)) ? mapName : "";
  const wdOn = game && /^wardogs\b/i.test(game.name) && wdCash && Date.now() - wdCash.at < 10 * 60000;
  const mKey = game ? game.name + "|" + realMap + (wdOn ? "|match" : "") : "";
  if (mKey !== matchKey) { matchKey = mKey; matchAt = Date.now(); }
  const startTs = game && (realMap || wdOn) ? matchAt : (dcGameAt || Date.now());
  const cut = (x, n) => x.length > n ? x.slice(0, n - 1) + "…" : x;
  if (game && song) {
    act = {
      type: 0, status_display_type: 2,
      details: cut("🎮 " + game.name + (rank ? " · " + rank : "") + (map ? " · " + map : ""), 120),
      state: cut("🎵 " + song.t + (song.a ? " — " + song.a : ""), 120),
      timestamps: { start: startTs },
      assets: mapImg
        ? Object.assign({ large_image: mapImg, large_text: cut(mapName || game.name, 120) }, (small && small.img) ? { small_image: small.img, small_text: cut(small.text || rank || game.name, 120) } : logo ? { small_image: logo, small_text: cut(rank || game.name, 120) } : {})
        : logo ? Object.assign({ large_image: logo, large_text: cut(game.name, 120) }, (small && small.img) ? { small_image: small.img, small_text: cut(small.text || rank || game.name, 120) } : {})
        : art ? { large_image: art, large_text: cut(song.t, 120) } : undefined
    };
  } else if (song) {
    act = {
      type: 2, details: cut(song.t, 120), state: cut(song.a || "YouTube Music", 120), status_display_type: 2,
      timestamps: { start: dcPresSongAt || Date.now() },
      assets: Object.assign({ large_text: "YouTube Music · Sothis" }, art ? { large_image: art } : {})
    };
  } else if (game) {
    act = {
      type: 0, status_display_type: 2, details: cut(game.name + (map ? " · " + map : ""), 120), state: rank || undefined,
      timestamps: { start: startTs },
      assets: mapImg ? Object.assign({ large_image: mapImg, large_text: cut(mapName || game.name, 120) }, (small && small.img) ? { small_image: small.img, small_text: cut(small.text || rank || game.name, 120) } : logo ? { small_image: logo, small_text: cut(rank || game.name, 120) } : {})
        : logo ? Object.assign({ large_image: logo, large_text: cut(game.name, 120) }, (small && small.img) ? { small_image: small.img, small_text: cut(small.text || rank || game.name, 120) } : {}) : undefined
    };
  }
  if (!act && dcPresOn() && settings.dcIdle !== false) {
    if (!dcIdleAt) dcIdleAt = Date.now();
    act = { type: 0, status_display_type: 2, details: "Idle on PC", timestamps: { start: dcIdleAt } };
  } else if (act) dcIdleAt = 0;
  // the member list says "Playing Sothis" (or "Listening to Sothis"); the details show on your profile card
  if (act && settings.dcNameOnly !== false) act.status_display_type = 0;
  if (act && !dcNoName) act.name = "Sothis";   // show "Sothis" as the activity name instead of the Discord app's name
  const key = JSON.stringify(act && Object.assign({}, act, { timestamps: undefined }));
  if (key === dcPresKey) return;
  dcPresKey = key;
  presLog("send: " + JSON.stringify(act));
  dcCmd("SET_ACTIVITY", { pid: process.pid, activity: act }).then(r => presLog("discord ok: " + JSON.stringify(r).slice(0, 400))).catch(e => {
    presLog("discord refused: " + String(e && e.message) + (e && e.code ? " code " + e.code : ""));
    dcPresKey = "";
    if (/didn't answer|Not connected|^closed$/.test(String(e && e.message))) return;
    // if this Discord version won't take a custom name, fall back to the app's own name
    if (act && act.name && !dcNoName && /\bname\b/i.test(String(e && e.message))) { dcNoName = true; delete act.name; dcCmd("SET_ACTIVITY", { pid: process.pid, activity: act }).then(() => { dcPresKey = key; }).catch(() => {}); }
  });
}
let dcNoName = false, matchKey = "", matchAt = 0;
let dcPresSong = "";
function dcPresenceFromPlayer() {
  const k = (player.title || "") + "\u0000" + (player.artist || "");
  if (k !== dcPresSong) { dcPresSong = k; dcPresSongAt = Date.now(); }
  dcPresence();
}
async function dcGamePoll() {
  if (!dcPresOn() || dc.status !== "ok" || process.platform !== "win32") return;
  let g = null; try { g = await dcGameNow(); } catch {}
  const was = dcGame ? dcGame.name : "", now = g ? g.name : "";
  if (was !== now) { if (STATS_KEY[was]) statsRefreshSoon(STATS_KEY[was]); dcGameAt = Date.now(); if (now !== "Overwatch 2") { owMapNow = null; owPhase = null; owHero = null; } if (now !== "Rainbow Six Siege") { r6MapNow = null; r6Op = null; } if (/^wardogs\b/i.test(was) || /^wardogs\b/i.test(now)) { wdFinish(); wdCash = null; if (settings.wdTeam) { settings.wdTeam = ""; saveSettings(); } } }
  dcGame = g;
  dcPresence();
}
setInterval(dcGamePoll, 10000);
// Keep the rank in your Discord status fresh: re-check your profile every couple of minutes while you play,
// and a few times right after a match/game ends (the stats sites take a minute or two to catch up).
const STATS_KEY = { "Overwatch 2": "ow", "Counter-Strike 2": "cs", "Rainbow Six Siege": "r6" };
const statsRefresh = g => { if (g && win && !win.isDestroyed()) win.webContents.send("stats:refresh", g); };
const statsRefreshSoon = g => { for (const ms of [45000, 120000, 300000]) setTimeout(() => statsRefresh(g), ms); };
setInterval(() => { const g = dcGame && STATS_KEY[dcGame.name]; if (g) statsRefresh(g); }, 150000);
setTimeout(dcGamePoll, 6000);
ipcMain.on("presence:switch", (_e, on) => { const v = !!on; if (v !== dcSwitchOn) { dcSwitchOn = v; dcGamePoll(); } });
ipcMain.handle("dc:nameOnly", (_e, on) => {
  if (typeof on === "boolean") { settings.dcNameOnly = on; saveSettings(); dcPresKey = "x"; dcPresence(); }
  return settings.dcNameOnly !== false;
});
ipcMain.handle("dc:idle", (_e, on) => {
  if (typeof on === "boolean") { settings.dcIdle = on; saveSettings(); dcPresKey = "x"; dcPresence(); }
  return settings.dcIdle !== false;
});
ipcMain.handle("dc:presence", (_e, on) => {
  if (typeof on === "boolean") { settings.dcPresence = on; saveSettings(); dcPresKey = "x"; dcPresence(); }
  return dcPresOn();
});
ipcMain.handle("r6:rank", (_e, { name, rp, img }) => {
  settings.r6RankName = String(name || "").replace(/^(no rank|not ranked)$/i, "Unranked").slice(0, 40); settings.r6RP = typeof rp === "number" ? rp : null; settings.r6RankImg = /^https:\/\//.test(img || "") ? img : "";
  saveSettings(); dcPresence();
  return true;
});

/* ---------- OBS controls: a small floating window that talks to OBS's WebSocket server ---------- */
let obsWin = null;
function obsExe() {
  const l = launchers().find(x => /obs64\.exe$/i.test(x.proc || x.path));
  if (l && fs.existsSync(l.path)) return l.path;
  const p = LAUNCH_PRESETS().find(x => x.name === "OBS Studio");
  return p ? p.path : "";
}
function showObsWin() {
  if (obsWin && !obsWin.isDestroyed()) { obsWin.show(); obsWin.focus(); return; }
  const W = 270, H = 520;
  let pos = settings.obsPos;
  const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  if (!pos || !screen.getAllDisplays().some(d => pos.x >= d.workArea.x - 50 && pos.x < d.workArea.x + d.workArea.width && pos.y >= d.workArea.y - 20 && pos.y < d.workArea.y + d.workArea.height))
    pos = { x: wa.x + wa.width - W - 24, y: wa.y + 80 };
  obsWin = new BrowserWindow({
    x: pos.x, y: pos.y, width: W, height: H, minWidth: 230, minHeight: 300, frame: false, transparent: true, resizable: true,
    alwaysOnTop: true, skipTaskbar: true, show: false, backgroundColor: "#00000000", title: "OBS controls",
    webPreferences: { preload: path.join(__dirname, "obs-preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  obsWin.setAlwaysOnTop(true, "screen-saver");
  obsWin.loadFile(path.join(__dirname, "obs.html"));
  obsWin.once("ready-to-show", () => obsWin.show());
  const remember = () => { if (obsWin && !obsWin.isDestroyed()) { const b = obsWin.getBounds(); settings.obsPos = { x: b.x, y: b.y }; saveSettings(); } };
  obsWin.on("moved", remember);
  obsWin.on("closed", () => { obsWin = null; });
}
function toggleObsWin() { if (obsWin && !obsWin.isDestroyed() && obsWin.isVisible()) obsWin.close(); else showObsWin(); }
function obsGetPass() { return memSecrets["obs.pass"] || decSecret((settings.obs || {}).pass); }
ipcMain.handle("obs:getPass", () => obsGetPass());
ipcMain.handle("obs:setPass", (_e, p) => {
  settings.obs = settings.obs || {};
  p = String(p || "").trim();
  delete memSecrets["obs.pass"];
  if (!p) delete settings.obs.pass;
  else { const e = encSecret(p); if (e) settings.obs.pass = e; else { delete settings.obs.pass; memSecrets["obs.pass"] = p; } }
  saveSettings(); return true;
});
ipcMain.handle("obs:open", () => {
  const exe = obsExe(); if (!exe) return false;
  try { require("child_process").spawn(exe, [], { detached: true, stdio: "ignore", cwd: path.dirname(exe) }).unref(); return true; } catch { return false; }
});
ipcMain.on("obs:close", () => { if (obsWin && !obsWin.isDestroyed()) obsWin.close(); });
ipcMain.handle("obs:toggle", () => { toggleObsWin(); return true; });

/* ---------- Switch pop-out: the Switch tab in its own window ---------- */
let swPopWin = null;
function openSwPop() {
  if (swPopWin && !swPopWin.isDestroyed()) { swPopWin.show(); swPopWin.focus(); return; }
  const b = settings.swPop || {};
  const ok = typeof b.x === "number" && screen.getAllDisplays().some(d => b.x >= d.workArea.x - 50 && b.x < d.workArea.x + d.workArea.width && b.y >= d.workArea.y - 20 && b.y < d.workArea.y + d.workArea.height);
  swPopWin = new BrowserWindow(Object.assign({
    width: b.w || 960, height: b.h || 540, minWidth: 320, minHeight: 180, frame: false, backgroundColor: "#000000", title: "Switch",
    icon: path.join(__dirname, "icon.png"), alwaysOnTop: !!settings.swPopTop, show: false,
    webPreferences: { preload: path.join(__dirname, "sw-pop-preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
  }, ok ? { x: b.x, y: b.y } : {}));
  swPopWin.setAspectRatio(16 / 9);
  if (settings.swPopTop) swPopWin.setAlwaysOnTop(true, "floating");
  swPopWin.loadFile(path.join(__dirname, "sw-pop.html"));
  swPopWin.once("ready-to-show", () => swPopWin.show());
  const remember = () => {
    if (!swPopWin || swPopWin.isDestroyed() || swPopWin.isFullScreen()) return;
    const r = swPopWin.getBounds(); settings.swPop = { x: r.x, y: r.y, w: r.width, h: r.height }; saveSettings();
  };
  swPopWin.on("moved", remember); swPopWin.on("resized", remember);
  swPopWin.on("enter-full-screen", () => { swPopWin.setAspectRatio(0); swPopWin.webContents.send("swpop:isfull", true); });
  swPopWin.on("leave-full-screen", () => { swPopWin.setAspectRatio(16 / 9); swPopWin.webContents.send("swpop:isfull", false); });
  swPopWin.on("closed", () => { swPopWin = null; if (win && !win.isDestroyed()) win.webContents.send("sw:pop", false); });
  if (win && !win.isDestroyed()) win.webContents.send("sw:pop", true);
}
ipcMain.handle("sw:popout", () => { openSwPop(); return true; });
ipcMain.handle("sw:popin", () => { if (swPopWin && !swPopWin.isDestroyed()) swPopWin.close(); return true; });
ipcMain.handle("sw:popped", () => !!(swPopWin && !swPopWin.isDestroyed()));
ipcMain.on("swpop:close", () => { if (swPopWin && !swPopWin.isDestroyed()) swPopWin.close(); });
ipcMain.on("swpop:full", (_e, on) => { if (swPopWin && !swPopWin.isDestroyed()) swPopWin.setFullScreen(typeof on === "boolean" ? on : !swPopWin.isFullScreen()); });
ipcMain.handle("swpop:top", () => {
  settings.swPopTop = !settings.swPopTop; saveSettings();
  if (swPopWin && !swPopWin.isDestroyed()) swPopWin.setAlwaysOnTop(!!settings.swPopTop, "floating");
  return !!settings.swPopTop;
});
ipcMain.handle("swpop:state", () => ({ top: !!settings.swPopTop }));

/* ---------- Map watcher: while Overwatch or Siege is in front, glance at the screen once a minute for the map name ---------- */
const OW_MAPS = ["Antarctic Peninsula", "Busan", "Ilios", "Lijiang Tower", "Nepal", "Oasis", "Samoa", "Circuit Royal", "Dorado", "Havana", "Junkertown", "Rialto",
  "Route 66", "Shambali Monastery", "Watchpoint: Gibraltar", "Blizzard World", "Eichenwalde", "Hollywood", "King's Row", "Midtown", "Numbani", "Paraíso",
  "Colosseo", "Esperança", "New Queen Street", "Runasapi", "New Junk City", "Suravasa", "Aatlis", "Hanaoka", "Throne of Anubis", "Château Guillard",
  "Kanezaka", "Malevento", "Petra", "Black Forest", "Castillo", "Ecopoint: Antarctica", "Necropolis", "Hanamura", "Temple of Anubis", "Volskaya Industries", "Horizon Lunar Colony", "Paris"];
const OW_MODES = [["COMPETITIVE", "Competitive"], ["QUICK PLAY", "Quick Play"], ["UNRANKED", "Quick Play"], ["ARCADE", "Arcade"], ["STADIUM", "Stadium"], ["CUSTOM GAME", "Custom"]];
const gameFg = name => GAME_FG[name] || (/^wardogs\b/i.test(name || "") ? /wardog/i : null);
// Wardogs: the three teams (read off the screen)
// Wardogs earnings log: the last cash reading of each match (a match ends after 3 minutes without one, or when the game closes)
let wdMatch = null;
function wdFinish() {
  const m = wdMatch; wdMatch = null;
  if (!m || typeof m.last !== "number" || !m.lastAt) return;
  settings.wdLog = (settings.wdLog || []).concat([{ at: m.lastAt, cash: m.last }]).slice(-300); saveSettings();
  presLog("wardogs: match logged " + (m.last < 0 ? "-" : "+") + "$" + Math.abs(m.last).toLocaleString("en-US"));
}
ipcMain.handle("wd:stats", () => {
  if (wdMatch && Date.now() - wdMatch.lastAt > 3 * 60000) wdFinish();
  const log = settings.wdLog || [], weekAgo = Date.now() - 7 * 864e5, week = log.filter(x => x.at >= weekAgo);
  const best = log.reduce((b, x) => (!b || x.cash > b.cash ? x : b), null);
  return { matches: log.length, best: best ? best.cash : null, bestAt: best ? best.at : 0, week: week.reduce((n, x) => n + x.cash, 0), weekMatches: week.length, now: wdMatch && typeof wdMatch.last === "number" ? wdMatch.last : null };
});
let wdShotN = 0, wdCash = null, wdMmLast = "", wdMmRun = 0;
/* Wardogs minimap (bottom left): you're the white arrow in the middle; your teammates are arrows in your team's colour.
   Enemies that get revealed sit in dark circles, and team bases have their name written over them, so both are skipped. */
function wdMinimapTeam(file, ocr) {
  const shot = nativeImage.createFromPath(file); if (shot.isEmpty()) return null;
  const { width: W, height: H } = shot.getSize();
  const rx = Math.round(0.017 * W), ry = Math.round(0.689 * H), rw = Math.round(0.133 * W), rh = Math.round(0.213 * H);
  const bm = shot.crop({ x: rx, y: ry, width: rw, height: rh }).toBitmap();   // BGRA
  if (bm.length < rw * rh * 4) return null;
  const col = new Int8Array(rw * rh).fill(-1), V = new Float32Array(rw * rh);
  const TEAM = ["VALKYRA", "LONESTAR", "MANTICORE"];   // red, blue, green
  for (let i = 0; i < rw * rh; i++) {
    const b = bm[i * 4] / 255, g = bm[i * 4 + 1] / 255, r = bm[i * 4 + 2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    V[i] = mx;
    if (mx < 0.5 || d / mx < 0.5) continue;
    let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; if (h < 0) h += 360;
    col[i] = h < 20 || h > 340 ? 0 : h > 185 && h < 225 ? 1 : h > 90 && h < 160 ? 2 : -1;
  }
  // team base labels (their name is read off the screen): skip anything just under them
  const labels = [];
  for (const l of (ocr && ocr.lines) || []) for (const w of l.words || []) {
    const t = String(w.t || "").toUpperCase().replace(/[^A-Z]/g, "");
    if (TEAM.includes(t) && w.x >= rx && w.x <= rx + rw && w.y >= ry && w.y <= ry + rh) labels.push({ x: w.x - rx + w.w / 2, y: w.y - ry + w.h });
  }
  const score = [0, 0, 0], seen = new Uint8Array(rw * rh), stack = [];
  for (let i = 0; i < rw * rh; i++) {
    if (col[i] < 0 || seen[i]) continue;
    const c = col[i]; let area = 0, sx = 0, sy = 0, x0 = rw, x1 = 0, y0 = rh, y1 = 0;
    stack.push(i); seen[i] = 1;
    while (stack.length) {
      const j = stack.pop(), x = j % rw, y = (j - x) / rw; area++; sx += x; sy += y;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const k of [j - 1, j + 1, j - rw, j + rw]) if (k >= 0 && k < rw * rh && !seen[k] && col[k] === c && Math.abs((k % rw) - x) <= 1) { seen[k] = 1; stack.push(k); }
    }
    if (area < 0.00012 * rw * rh) continue;
    const cx = sx / area, cy = sy / area;
    if (Math.hypot(cx / rw - 0.5, cy / rh - 0.5) > 0.24) continue;   // only around you (the middle)
    if (labels.some(L => Math.abs(cx - L.x) < 0.09 * rw && cy - L.y > -0.02 * rh && cy - L.y < 0.12 * rh)) continue;
    // dark ring around it = a revealed enemy
    const m = Math.max(4, Math.round(0.5 * Math.max(x1 - x0, y1 - y0))); let n = 0, dark = 0;
    for (let y = Math.max(0, y0 - m); y <= Math.min(rh - 1, y1 + m); y++) for (let x = Math.max(0, x0 - m); x <= Math.min(rw - 1, x1 + m); x++) {
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) continue; n++; if (V[y * rw + x] < 0.12) dark++;
    }
    if (n && dark / n > 0.45) continue;
    score[c] += area;
  }
  const order = [0, 1, 2].sort((a, b) => score[b] - score[a]), best = order[0], next = score[order[1]];
  const min = 0.0012 * rw * rh;   // about two arrows' worth
  return { team: score[best] >= min && score[best] >= 1.8 * next ? TEAM[best] : null, score };
}   // wdCash: your match cash change (the left of the two cash numbers, top right)
// "-$5,040" / "$5,040" / "-$4 780" → "-$5,040"; null if it doesn't look like money
function wdMoney(t) {
  const m = /([-+−–]?)\s*\$\s*(\d{1,3}(?:[,. ]\d{3})+|\d{1,6})(?![.,]?\d)/.exec(String(t || ""));
  if (!m) return null;
  const n = parseInt(m[2].replace(/[^\d]/g, ""), 10); if (!isFinite(n)) return null;
  return { neg: m[1] !== "" && m[1] !== "+", signed: m[1] !== "", n };
}
const WD_TEAMS = { LONESTAR: "Lonestar (Blue)", VALKYRA: "Valkyra (Red)", MANTICORE: "Manticore (Green)" };
// your team (settings.wdTeam): only what you pick on Home, cleared each time Wardogs starts or closes
// each team's logo (cut from GameWatcher's faction picture by images.weserv.nl) for Discord's small picture
const WD_LOGO_SRC = encodeURIComponent("images.gamewatcherstatic.com/image/file/1/62/138071/Wardogs_factions_logo_image.jpg?v=2.1787315491");
const WD_LOGO = Object.fromEntries([["LONESTAR", 275, 340], ["VALKYRA", 763, 340], ["MANTICORE", 1249, 339]].map(([k, x, y]) =>
  [k, `https://images.weserv.nl/?url=${WD_LOGO_SRC}&cx=${x}&cy=${y}&cw=400&ch=400&precrop&w=256&h=256&output=png`]));
const wdTeamName = () => WD_TEAMS[String(settings.wdTeam || "").toUpperCase()] || "";
function wdTeamSet(k) {
  k = String(k || "").toUpperCase(); if (k && !WD_TEAMS[k]) return false;
  if ((settings.wdTeam || "") === k.toLowerCase()) return true;
  settings.wdTeam = k.toLowerCase(); saveSettings(); dcPresence(); return true;
}
const GAME_FG = { "Overwatch 2": /^overwatch\.exe$/i, "Rainbow Six Siege": /^rainbowsix(_vulkan|_be)?\.exe$/i };
const normTxt = t => " " + String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/['’`]/g, "").replace(/[^A-Z0-9]+/g, " ").trim() + " ";
// Your rank for the role of the hero you're on (falls back to your best role)
function owRankNow() {
  const gr = settings.gameRanks || {};
  const inMenu = owPhase && (owPhase.kind === "menu" || owPhase.kind === "queue");
  if (owHero && owHeroes && !inMenu) {
    const h = owHeroes.find(x => x.name === owHero.name);
    const role = h && { tank: "Tank", damage: "Damage", support: "Support" }[String(h.role).toLowerCase()];
    if (role) return settings.owRoles && settings.owRoles[role] ? settings.owRoles[role] + " " + role : "Unranked " + role;
  }
  return gr.ow || "";
}
let mapBusy = false;
/* Hero picture matching: the HUD shows your hero's portrait in a hexagon bottom-left, next to your health.
   Each hero's portrait (from OverFast) is shrunk to a small colour grid; the screen spot is compared to all of them. */
const HERO_N = 24;
let heroPics = null, heroPicsBusy = null;
function heroVec(img) {
  const bm = img.resize({ width: HERO_N, height: HERO_N, quality: "best" }).toBitmap();   // BGRA
  if (bm.length < HERO_N * HERO_N * 4) return null;
  const v = [], c = (HERO_N - 1) / 2, r2 = (HERO_N * 0.42) ** 2;
  for (let y = 0; y < HERO_N; y++) for (let x = 0; x < HERO_N; x++) {
    if ((x - c) ** 2 + (y - c) ** 2 > r2) continue;   // just the middle (the face), not the frame around it
    const i = (y * HERO_N + x) * 4; v.push(bm[i + 2], bm[i + 1], bm[i]);
  }
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  let n = 0; for (let i = 0; i < v.length; i++) { v[i] -= m; n += v[i] * v[i]; }
  n = Math.sqrt(n) || 1; for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}
async function heroPicsLoad() {
  if (heroPics) return heroPics;
  if (heroPicsBusy) return heroPicsBusy;
  heroPicsBusy = (async () => {
    if (!owHeroes) { const r = await owFetch("/heroes?locale=en-us"); if (r.status === 200 && Array.isArray(r.json)) owHeroes = r.json.map(h => ({ key: h.key, name: h.name, portrait: h.portrait, role: h.role })); }
    if (!owHeroes || !owHeroes.length) { heroPicsBusy = null; return null; }
    const dir = path.join(DATA_DIR, "heroes"); try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    const { net: enet } = require("electron"), out = [];
    for (const h of owHeroes) {
      if (!h.key || !/^https:\/\//.test(h.portrait || "")) continue;
      const f = path.join(dir, h.key.replace(/[^a-z0-9-]/gi, "") + ".png");
      try {
        if (!fs.existsSync(f)) { const r = await enet.fetch(h.portrait); if (!r.ok) continue; fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); }
        const img = nativeImage.createFromPath(f); if (img.isEmpty()) continue;
        const v = heroVec(img); if (v) out.push({ name: h.name, img: h.portrait, v });
      } catch {}
    }
    heroPics = out.length ? out : null; heroPicsBusy = null;
    return heroPics;
  })();
  return heroPicsBusy;
}
// Heroes you've told Sothis about (with the skin you use): Roaming\Sothis\hero-refs.json
const HERO_REFS = path.join(DATA_DIR, "hero-refs.json");
let heroRefs = null, hudLast = null, owTeach = null;   // owTeach: a hero you picked before Sothis had seen your HUD — learned the next time it does   // hudLast: the latest hero-picture spot from the screen
function heroRefsGet() {
  if (settings.heroRefsV !== 2) { try { fs.unlinkSync(HERO_REFS); } catch {} heroRefs = null; settings.heroRefsV = 2; saveSettings(); }
  if (!heroRefs) { try { heroRefs = JSON.parse(fs.readFileSync(HERO_REFS, "utf8")).filter(r => r && r.name && Array.isArray(r.v)); } catch { heroRefs = []; } } return heroRefs; }
function heroRefsSave() { try { fs.writeFileSync(HERO_REFS, JSON.stringify(heroRefs.slice(-150))); } catch {} }
async function owHeroFromHud(file) {
  const pics = (await heroPicsLoad()) || [];
  const refs = heroRefsGet().map(r => ({ name: r.name, v: r.v, learned: true }));
  if (!pics.length && !refs.length) return;
  const shot = nativeImage.createFromPath(file); if (shot.isEmpty()) return;
  const { width: W, height: H } = shot.getSize();
  // where the portrait sits on a 16:9 screen (measured on a 2560x1440 screenshot), tried at a few sizes/offsets
  const cx = 0.0547 * W, cy = 0.878 * H, side = 0.0586 * W;
  const best = new Map();
  for (const sc of [0.85, 1, 1.15]) for (const dx of [-0.006, 0, 0.006]) for (const dy of [-0.01, 0, 0.01]) {
    const sd = Math.round(side * sc), x = Math.round(cx + dx * W - sd / 2), y = Math.round(cy + dy * H - sd / 2);
    if (x < 0 || y < 0 || x + sd > W || y + sd > H) continue;
    const v = heroVec(shot.crop({ x, y, width: sd, height: sd })); if (!v) continue;
    if (sc === 1 && dx === 0 && dy === 0) {
      hudLast = { v: v.map(n => Math.round(n * 1e4) / 1e4), at: Date.now() };
      if (owTeach && Date.now() < owTeach.until) {
        heroRefsGet().push({ name: owTeach.name, v: hudLast.v, at: Date.now() }); heroRefsSave();
        mapLog("learned the hero picture for " + owTeach.name + " (from your HUD)"); owTeach = null; return;
      }
    }
    for (const p of refs.concat(pics)) {
      if (p.v.length !== v.length) continue;
      let d = 0; for (let i = 0; i < v.length; i++) d += v[i] * p.v[i];
      if (!p.learned) d -= 0.15;   // official pictures don't show your skin: trust them less than ones you taught it
      if (!best.has(p.name) || d > best.get(p.name).d) best.set(p.name, { d, p });
    }
  }
  const ranked = [...best.values()].sort((a, b) => b.d - a.d);
  if (!ranked.length) return;
  const [a, b] = ranked;
  mapLog("hero picture: " + ranked.slice(0, 3).map(r => r.p.name + " " + r.d.toFixed(2)).join(", "));
  if (a.d >= 0.7 && (!b || a.d - b.d >= 0.06)) {
    if (!owHero || owHero.name !== a.p.name) { owHero = { name: a.p.name, at: Date.now() }; mapLog("overwatch: playing " + a.p.name + " (from the hero picture)"); dcPresence(); }
    else owHero.at = Date.now();
  }
}
async function mapWatch() {
  const gm = (typeof sess !== "undefined" && sess) ? { name: sess.game } : dcGame;
  if (mapBusy || r6TabBusy || !gm || !gameFg(gm.name)) return;
  if (settings.mapWatch === false) return;
  mapBusy = true;
  let file = null;
  try {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    file = await r6GrabScreen(display);
    if (!file) return;
    const ocr = await r6Ocr(file, 1, true);
    if (!ocr || ocr.error) { mapLog("map check failed: " + (ocr && ocr.error || "no result")); return; }
    if (!gameFg(gm.name).test(ocr.fg || "")) { mapLog("map check skipped: " + (ocr.fg || "another app") + " was in front"); return; }   // only trust what the game itself shows
    const raw = (ocr.lines || []).map(l => l.t).join(" | ");
    const text = normTxt(raw);
    if (!(ocr.lines || []).length) mapLog("map check: the screen grab was blank — the game is probably in exclusive Fullscreen (use Borderless Windowed)");
    if (gm.name === "Overwatch 2") {
      // during the map vote / ban several maps are on screen: wait until only the chosen one is left
      let left = text; const seen = [];
      for (const m of OW_MAPS.slice().sort((a, b) => b.length - a.length)) { const k = normTxt(m); if (left.includes(k)) { seen.push(m); left = left.split(k).join(" "); } }
      const voting = seen.length > 1 || / (VOTE|VOTES|VOTING|BAN|BANNED|BANS|VETO) /.test(text);
      if (voting && seen.length) mapLog("overwatch: map vote on screen (" + seen.join(", ") + "), waiting");
      // the Practice Range: its name, or the training bots' name tags
      const range = / PRACTICE RANGE | FIRING RANGE /.test(text) || / (STANDARD|TANK|ROCKET|TRAINING|HEALING|SNIPER) BOT /.test(text);
      const hit = voting ? null : seen[0] || (range ? "Practice Range" : null);
      // main menu: its top bar (PLAY / HEROES / EVENTS / CAREER / SHOP …); queue: the "searching" banner
      const menuWords = ["PLAY", "HEROES", "EVENTS", "CAREER", "SHOP", "BATTLE PASS", "SOCIAL", "CHALLENGES", "HERO GALLERY", "OPTIONS"].filter(w => text.includes(" " + w + " ")).length;
      const queue = / SEARCHING | FINDING (A )?(GAME|MATCH) | IN QUEUE | TIME ELAPSED /.test(text);
      const inMatch = hit || / (STOP THE PAYLOAD|ESCORT THE PAYLOAD|PUSH THE ROBOT|CAPTURE THE OBJECTIVE|DEFEND THE OBJECTIVE|CONTEST THE OBJECTIVE|ATTACK|DEFEND|ELIMINATED|OVERTIME|ASSEMBLE YOUR TEAM|PREPARE TO ATTACK|PREPARE TO DEFEND) /.test(text) || /\d+\.\d+\s?m\b/i.test(raw);   // payload distance like "74.57m"
      // your health numbers bottom-left (e.g. "525 | 525") mean you're actually in the game, not a menu
      const W0 = ocr.w || 1, H0 = ocr.h || 1;
      const hud = (ocr.lines || []).some(l => (l.words || []).some(w => /^\d{2,4}$/.test(w.t) && w.y > 0.78 * H0 && w.x < 0.25 * W0));
      let phase = !inMatch && queue ? "queue" : !inMatch && menuWords >= 3 ? "menu" : (inMatch || hud) ? "match" : "";
      if (!phase && owPhase && owPhase.kind === "menu") phase = "menu";   // other menu pages (career, social…) still count as the menus
      // the hero picture next to your health bar (bottom left): only when your health bar is on screen
      if (phase === "match" && hud && file) { try { await owHeroFromHud(file); } catch {} }
      // keep one in-match screenshot so the hero picture's spot on screen can be worked out (Roaming\Sothis\ow-hud-sample.png)
      if ((phase === "match" || (!phase && (ocr.lines || []).length)) && !owHudSaved && file) { owHudSaved = true; try { fs.copyFileSync(file, path.join(DATA_DIR, "ow-hud-sample.png")); mapLog("saved a match screenshot for hero detection"); } catch {} }
      if (phase && phase !== (owPhase && owPhase.kind)) { mapLog("overwatch: " + (phase === "menu" ? "in the menus" : phase === "queue" ? "in queue" : "in a match")); }
      // your rank, read off the screen right after a competitive match (e.g. "EMERALD 5")
      if (!inMatch && / COMPETITIVE /.test(text)) {
        const rk = [...text.matchAll(/ (BRONZE|SILVER|GOLD|PLATINUM|EMERALD|DIAMOND|MASTER|GRANDMASTER|CHAMPION) ([1-5]) /g)];
        const roles = ["TANK", "DAMAGE", "SUPPORT", "OPEN QUEUE"].filter(r => text.includes(" " + r + " "));
        if (rk.length === 1) {
          const cap = w => w[0] + w.slice(1).toLowerCase();
          const prev = (settings.gameRanks || {}).ow || "";
          const role = roles.length === 1 ? (roles[0] === "OPEN QUEUE" ? "Open Queue" : cap(roles[0])) : (prev.match(/(Tank|Damage|Support|Open Queue)$/) || [])[1] || "";
          const next = cap(rk[0][1]) + " " + rk[0][2] + (role ? " " + role : "");
          const rl = (next.match(/(Tank|Damage|Support)$/) || [])[1];
          if (rl) { const rv = cap(rk[0][1]) + " " + rk[0][2]; if (!settings.owRoles || settings.owRoles[rl] !== rv) { settings.owRoles = Object.assign({}, settings.owRoles, { [rl]: rv }); settings.owRolesSeen = { role: rl, at: Date.now() }; saveSettings(); dcPresence(); } }
          if (next !== prev) { settings.gameRanks = Object.assign({}, settings.gameRanks, { ow: next }); owRankSeenAt = Date.now(); saveSettings(); mapLog("rank read from screen: " + next); dcPresence(); }
        }
      }
      if (phase) {
        const was = owPhase && owPhase.kind;
        // a match just ended: ask the Stats page to fetch your profile again in a couple of minutes
        if (was === "match" && phase !== "match") statsRefreshSoon("ow");
        if (phase === "menu" && was !== "menu") { statsRefresh("ow"); mapLog("overwatch: back in the menus, refreshing your rank"); }   // fresh rank as soon as you're back in the menus
        owPhase = { kind: phase, at: Date.now() };
        if (phase !== "match") { if (owMapNow) owMapNow = null; owHero = null; }   // the last match is over
        if (phase !== was) dcPresence();
      }
      if (hit) {
        const mode = (OW_MODES.find(([k]) => text.includes(" " + k + " ")) || [])[1] || (owMapNow && owMapNow.name === hit ? owMapNow.mode : "");
        const changed = !owMapNow || owMapNow.name !== hit || owMapNow.mode !== mode;
        owMapNow = { name: hit, mode, at: Date.now(), img: (owMapNow && owMapNow.name === hit && owMapNow.img) || "" };
        if (!owMapNow.img) { const img = await owMapImg(hit); if (img && owMapNow && owMapNow.name === hit) { owMapNow.img = img; dcPresence(); } }
        if (changed) { dcPresence(); mapLog("map found: " + hit + (mode ? " · " + mode : "")); }
        mapHitAt = Date.now();
      } else if ((ocr.lines || []).length) mapLog("map check: no map name on screen (" + raw.slice(0, 90).replace(/\s+/g, " ") + ")");
    } else if (/^wardogs\b/i.test(gm.name)) {
      // your team: when just one of the three team names is on screen (not the team pick screen, which shows all three)
      const seen = Object.keys(WD_TEAMS).filter(k => text.includes(" " + k + " "));
      // your team from the minimap (your teammates' arrow colour); it takes two matching looks in a row to switch
      if (file && !(seen.length > 1)) {
        let mm = null; try { mm = wdMinimapTeam(file, ocr); } catch {}
        if (mm && mm.team) {
          wdMmRun = mm.team === wdMmLast ? wdMmRun + 1 : 1; wdMmLast = mm.team;
          if (wdMmRun >= 2 && wdTeamName() !== WD_TEAMS[mm.team]) { wdTeamSet(mm.team); mapLog("wardogs: minimap says you're on " + WD_TEAMS[mm.team] + " (" + mm.score.join("/") + ")"); }
        }
      }
      // cash, top right: two numbers side by side (your gain/loss, then your total); the left one is what you're up or down
      {
        const W0 = ocr.w || 1, H0 = ocr.h || 1, cash = [];
        for (const l of ocr.lines || []) {
          const ws = (l.words || []).filter(w => w.x > 0.55 * W0 && w.y < 0.22 * H0);
          for (let k = 0; k < ws.length; k++) {
            if (!/\$/.test(ws[k].t)) continue;
            const v = wdMoney(ws[k].t + (ws[k + 1] && /^\d{3}\b/.test(ws[k + 1].t) ? " " + ws[k + 1].t : ""));
            if (v && (v.signed || v.n >= 100)) cash.push(Object.assign(v, { x: ws[k].x }));
          }
        }
        cash.sort((a, b) => a.x - b.x);
        const pick = cash.length >= 2 ? cash[0] : cash.length === 1 && cash[0].signed ? cash[0] : null;
        if (pick) {
          const txt = (pick.neg ? "-" : "+") + "$" + pick.n.toLocaleString("en-US");
          const changed = !wdCash || wdCash.txt !== txt; wdCash = { txt, at: Date.now() };
          if (!wdMatch || Date.now() - wdMatch.lastAt > 3 * 60000) { wdFinish(); wdMatch = { start: Date.now() }; }
          wdMatch.last = pick.neg ? -pick.n : pick.n; wdMatch.lastAt = Date.now();
          if (changed) { mapLog("wardogs: cash " + txt); dcPresence(); }
        }
      }
      if (seen.length === 1) {
        mapLog("wardogs: only " + WD_TEAMS[seen[0]] + " on screen (not used)");
      } else if (seen.length > 1) {
        // the team pick screen: keep a few screenshots so the highlighted (picked) team can be worked out later
        mapLog("wardogs: team pick on screen (" + seen.join(", ") + ")");
        if (file) { wdShotN = wdShotN % 4 + 1; try { fs.copyFileSync(file, path.join(DATA_DIR, "wardogs-pick-" + wdShotN + ".png")); } catch {} }
      }
      else if ((ocr.lines || []).length) mapLog("wardogs: no team name on screen (" + raw.slice(0, 90).replace(/\s+/g, " ") + ")");
    } else {
      const cfg = await r6Config();
      const maps = cfg && cfg.maps ? Object.entries(cfg.maps).filter(([, x]) => typeof x === "string" && x.length > 3 && !/unknown/i.test(x)) : [];
      let hit = maps.sort((a, b) => b[1].length - a[1].length).find(([, m]) => text.includes(normTxt(m)));
      if (!hit) { const rg = / SHOOTING RANGE /.test(text) ? "Shooting Range" : / TRAINING GROUNDS /.test(text) ? "Training Grounds" : ""; if (rg) hit = ["", rg]; }
      // main menu (its top bar): the match is over, so no map or operator
      const menuWords = ["PLAY", "OPERATORS", "BATTLE PASS", "STORE", "SHOP", "NEWS", "CAREER", "LOCKER", "EVENTS"].filter(w => text.includes(" " + w + " ")).length;
      if (menuWords >= 3 && !hit) {
        if (r6MapNow || r6Op) { r6MapNow = null; r6Op = null; mapLog("siege: back in the menus"); dcPresence(); }
      } else {
        if (hit) { const changed = !r6MapNow || r6MapNow.name !== hit[1]; r6MapNow = { name: hit[1], slug: hit[0], at: Date.now() }; if (changed) { dcPresence(); r6ShotsUntil = Date.now() + 4 * 60000; } }
        // right after a map shows up (operator selection comes next) keep a few screenshots so the operator spot can be worked out
        if (file && Date.now() < r6ShotsUntil) { r6ShotN = r6ShotN % 8 + 1; try { fs.copyFileSync(file, path.join(DATA_DIR, "r6-sample-" + r6ShotN + ".png")); } catch {} }
        if ((ocr.lines || []).length) mapLog("siege screen: " + raw.slice(0, 140).replace(/\s+/g, " "));
        // operator selection: your pick is the slot farthest right along the top; its name is read off the screen
        const ops = cfg && cfg.ops ? Object.values(cfg.ops).filter(o => o && o.name && normTxt(o.name).length > 3) : [];
        const W0 = ocr.w || 1, H0 = ocr.h || 1, found = [];
        for (const l of ocr.lines || []) for (const w of l.words || []) {
          const k = normTxt(w.t); const o = ops.find(o => normTxt(o.name) === k);
          if (o) found.push({ name: o.name, x: w.x, y: w.y });
        }
        const opScreen = / (OPERATOR|OPERATORS|SELECT|SELECTION|LOADOUT|CONFIRM|RANDOM|ATTACKERS|DEFENDERS) /.test(text);
        if (found.length && opScreen) {
          if (!r6OpSaved && file) { r6OpSaved = true; try { fs.copyFileSync(file, path.join(DATA_DIR, "r6-opselect-sample.png")); } catch {} }
          const top = found.filter(f => f.y < 0.3 * H0 && f.x > 0.5 * W0).sort((a, b) => b.x - a.x);
          const names = [...new Set(found.map(f => f.name))];
          const pick = top[0] || (names.length === 1 ? found[0] : null);
          mapLog("siege: operators on screen: " + found.map(f => f.name + "@" + Math.round(100 * f.x / W0) + "," + Math.round(100 * f.y / H0)).join(" ") + (pick ? " → you: " + pick.name : ""));
          if (pick) { const changed = !r6Op || r6Op.name !== pick.name; r6Op = { name: pick.name, slug: r6OpSlug(pick.name), at: Date.now() }; if (changed) dcPresence(); }
        } else if (r6Op && found.some(f => f.name === r6Op.name)) r6Op.at = Date.now();
      }
    }
  } catch {} finally {
    mapBusy = false;
    if (file) try { fs.unlinkSync(file); } catch {}
  }
}
// Look often while the game is up (the map name is only on screen at the start of a match and on the Tab screen),
// then ease off once the map is known.
let mapHitAt = 0, mapLogLast = "";
function mapLog(t) { const k = t.slice(0, 40); if (k === mapLogLast) return; mapLogLast = k; try { presLog(t); } catch {} }
function mapLoop() {
  const gm = (typeof sess !== "undefined" && sess) ? { name: sess.game } : dcGame;
  const playing = gm && gameFg(gm.name) && settings.mapWatch !== false;
  const recent = Date.now() - mapHitAt < 4 * 60000;
  if (playing) mapWatch();
  setTimeout(mapLoop, !playing ? 30000 : recent ? 20000 : 10000);
}
setTimeout(mapLoop, 20000);
ipcMain.handle("map:watch", (_e, on) => { if (typeof on === "boolean") { settings.mapWatch = on; saveSettings(); if (!on) { owMapNow = null; dcPresence(); } } return settings.mapWatch !== false; });

/* ---------- Voice overlay: who's in your Discord call, on top of your games ---------- */
let voWin = null, voReady = false, voSize = { w: 260, h: 60 };
const voCfg = () => Object.assign({ on: false, corner: "top-left", onlyTalking: false, display: "primary", showHead: true }, settings.vo || {});
function voDisplay() {
  const c = voCfg(), all = screen.getAllDisplays();
  return all.find(d => String(d.id) === String(c.display)) || screen.getPrimaryDisplay();
}
function voPlace() {
  if (!voWin || voWin.isDestroyed()) return;
  const c = voCfg(), b = voDisplay().bounds, m = 14;
  const w = Math.max(1, Math.min(300, voSize.w)), h = Math.max(1, Math.min(b.height - 2 * m, voSize.h));
  const x = /right/.test(c.corner) ? b.x + b.width - w - m : b.x + m;
  const y = /bottom/.test(c.corner) ? b.y + b.height - h - m - 40 : b.y + m + 30;
  voWin.setBounds({ x, y, width: w, height: h });
}
function voEnsure() {
  if (voWin && !voWin.isDestroyed()) return voWin;
  voReady = false;
  voWin = new BrowserWindow({
    width: 260, height: 60, show: false, frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false,
    fullscreenable: false, skipTaskbar: true, focusable: false, hasShadow: false, alwaysOnTop: true, backgroundColor: "#00000000",
    webPreferences: { preload: path.join(__dirname, "vo-preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
  });
  voWin.setAlwaysOnTop(true, "screen-saver");
  voWin.setVisibleOnAllWorkspaces(true);
  voWin.setIgnoreMouseEvents(true);   // never gets in the way of your clicks
  voWin.loadFile(path.join(__dirname, "vo.html"));
  voWin.webContents.on("did-finish-load", () => { voReady = true; voUpdate(); });
  voWin.on("closed", () => { voWin = null; voReady = false; });
  return voWin;
}
// Which program is in front: one small background helper reports it whenever it changes
let fgNow = { name: "", path: "" }, fgProc = null;
const isGameFg = f => !!f.name && (Object.prototype.hasOwnProperty.call(GAME_EXES, f.name.toLowerCase()) ||
  /\\steamapps\\common\\|\\epic games\\|\\riot games\\|\\ubisoft game launcher\\games\\|\\ea games\\|\\xboxgames\\|\\gog galaxy\\games\\/i.test(f.path || ""));
function fgWatch() {
  if (process.platform !== "win32" || fgProc) return;
  const ps = `Add-Type -Namespace SothisFg2 -Name W -MemberDefinition '[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint p);'
$last = ''
while ($true) {
  try { $p = [uint32]0; $null = [SothisFg2.W]::GetWindowThreadProcessId([SothisFg2.W]::GetForegroundWindow(), [ref]$p); $pr = Get-Process -Id $p -ErrorAction Stop; $cur = $pr.ProcessName + '.exe|' + $pr.Path } catch { $cur = '|' }
  if ($cur -ne $last) { [Console]::Out.WriteLine($cur); [Console]::Out.Flush(); $last = $cur }
  Start-Sleep -Milliseconds 700
}`;
  try {
    fgProc = require("child_process").spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { windowsHide: true });
    let buf = "";
    fgProc.stdout.on("data", d => {
      buf += d; const lines = buf.split(/\r?\n/); buf = lines.pop();
      const last = lines.filter(Boolean).pop(); if (!last) return;
      const [name, ...rest] = last.split("|"); fgNow = { name: name || "", path: rest.join("|") };
      try { voUpdate(); } catch {}
    });
    fgProc.on("exit", () => { fgProc = null; setTimeout(() => { if (voCfg().on) fgWatch(); }, 5000); });
  } catch { fgProc = null; }
}
app.on("will-quit", () => { try { fgProc && fgProc.kill(); } catch {} });
function voUpdate() {
  try { duckSignal(); } catch {}
  const c = voCfg(), st = dcState();
  if (c.on) fgWatch();
  const show = c.on && st.status === "ok" && !!st.channel && isGameFg(fgNow);   // only over your games
  if (!show) { if (voWin && !voWin.isDestroyed()) voWin.hide(); return; }
  const w = voEnsure();
  if (!voReady) return;
  w.webContents.send("vo:state", Object.assign({ corner: c.corner, onlyTalking: c.onlyTalking, showHead: c.showHead }, st));
  voPlace();
  if (!w.isVisible()) { w.showInactive(); w.setAlwaysOnTop(true, "screen-saver"); }
}
ipcMain.on("vo:size", (_e, { w, h }) => { voSize = { w: w + 2, h: h + 2 }; voPlace(); });
ipcMain.handle("vo:get", () => Object.assign(voCfg(), { displays: screen.getAllDisplays().map((d, i) => ({ id: String(d.id), name: (d.label || "Monitor " + (i + 1)) + (d.id === screen.getPrimaryDisplay().id ? " (main)" : "") })) }));
ipcMain.handle("vo:set", (_e, patch) => {
  const ok = ["on", "corner", "onlyTalking", "display", "showHead"];
  settings.vo = Object.assign({}, voCfg(), Object.fromEntries(Object.entries(patch || {}).filter(([k]) => ok.includes(k))));
  saveSettings(); voUpdate();
  return voCfg();
});

/* ---------- Medal: save a clip by pressing Medal's clip key for you ---------- */
const MEDAL_KEYS = ["F6", "F7", "F8", "F9", "F10", "F11", "F12"];
const medalKey = () => MEDAL_KEYS.includes(settings.medalKey) ? settings.medalKey : "F8";
function pressKey(key) {
  const vk = 0x6F + Number(String(key).replace(/\D/g, ""));   // F1 = 0x70
  const ps = `Add-Type -Namespace S -Name K -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte v, byte s, uint f, System.UIntPtr e); [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint c, uint t);'; $s=[byte][S.K]::MapVirtualKey(${vk},0); [S.K]::keybd_event(${vk},$s,0,[System.UIntPtr]::Zero); Start-Sleep -Milliseconds 60; [S.K]::keybd_event(${vk},$s,2,[System.UIntPtr]::Zero)`;
  return new Promise(res => execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { windowsHide: true, timeout: 8000 }, err => res(!err)));
}
async function doClip() {
  if (process.platform !== "win32") return { ok: false, err: "Only works on Windows" };
  // Sothis's own recorder first; Medal only if ours isn't recording and Medal is open
  const C = clipper();
  if (C.state().recording) return C.save();
  if (!(await runningSet()).has("medal.exe")) return C.save();
  const run = await runningSet();
  if (![...run].some(p => /^medal(encoder)?\.exe$/i.test(p) || p === "medal.exe")) return { ok: false, err: "Medal isn't running. Open Medal first." };
  const key = medalKey();
  // our own scoreboard key must not fire when we press Medal's key
  const clash = r6TabKey === key;
  if (clash) { try { globalShortcut.unregister(key); } catch {} }
  const ok = await pressKey(key);
  if (clash) setTimeout(() => { try { globalShortcut.register(key, () => { r6TabRun(); }); } catch {} }, 400);
  return ok ? { ok: true, key } : { ok: false, err: "Couldn't press the clip key." };
}
ipcMain.handle("medal:clip", () => doClip());
/* Clips page: your Medal clips folder, inside Sothis */
const clipsDir = () => settings.clipsDir && fs.existsSync(settings.clipsDir) ? settings.clipsDir : path.join(app.getPath("videos"), "Medal");
const VID_RE = /\.(mp4|mkv|webm|mov|m4v)$/i;
/* Sothis's own clips (clipper.js): records the last 15-120 s while you play and saves on your clip key */
let clipperObj = null, audioReqs = {}, audioReqN = 0;
function clipper() {
  if (clipperObj) return clipperObj;
  clipperObj = require("./clipper.js")({
    app, screen, DATA_DIR, VID_RE, clipsDir,
    log: t => { try { presLog(t); } catch {} },
    getSettings: () => settings,
    gameRect: () => gameWindowRect(),
    currentGame: () => (sess && sess.game) || (dcGame && dcGame.name !== "a Steam game" ? dcGame.name : "") || "",
    onState: st => { try { clipHideApply(); } catch {} if (win && !win.isDestroyed()) win.webContents.send("clip:state", Object.assign({}, st, { ready: !!clipperObj && !!clipperObj.ffExe() })); },
    setAudio: o => { if (win && !win.isDestroyed()) win.webContents.send("clip:audio", o); },
    requestAudio: (from, dur) => new Promise(res => {
      if (!win || win.isDestroyed()) return res(null);
      const id = ++audioReqN; audioReqs[id] = res;
      win.webContents.send("clip:audioReq", { id, from, dur });
      setTimeout(() => { if (audioReqs[id]) { delete audioReqs[id]; res(null); } }, 6000);
    }),
    notify: (name, file) => {
      if (win && !win.isDestroyed()) win.webContents.send("clip:saved", { name, file });
      try { if (Notification.isSupported()) { const n = new Notification({ title: "Clip saved", body: name, icon: path.join(__dirname, "icon.png"), silent: true }); n.on("click", () => shell.showItemInFolder(file)); n.show(); } } catch {}
    }
  });
  return clipperObj;
}
// Sothis's own windows stay out of clips while the recorder runs (Windows leaves them out of screen captures)
let clipHidden = false;
function clipHideApply() {
  const want = !!(clipperObj && clipperObj.state().recording) && ((settings.clips || {}).hideSothis !== false);
  if (want === clipHidden) return;
  clipHidden = want;
  for (const w of BrowserWindow.getAllWindows()) { try { if (!w.isDestroyed()) w.setContentProtection(want); } catch {} }
}
app.on("browser-window-created", (_e, w) => { if (clipHidden) { try { w.setContentProtection(true); } catch {} } });
// where the game's window is (its inside, without the title bar), in real screen pixels, plus the screen it's on
function gameWindowRect() {
  const exe = sess && sess.exe ? String(sess.exe).replace(/\.exe$/i, "").replace(/[^\w .-]/g, "") : "";
  const ps = `$ErrorActionPreference='SilentlyContinue'
Add-Type -Namespace S -Name W -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); [DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern bool GetClientRect(System.IntPtr h, out RECT r); [DllImport("user32.dll")] public static extern bool ClientToScreen(System.IntPtr h, ref POINT p); [DllImport("user32.dll")] public static extern System.IntPtr MonitorFromWindow(System.IntPtr h, uint f); [DllImport("user32.dll")] public static extern bool GetMonitorInfo(System.IntPtr m, ref MI i); [DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr h); public struct RECT { public int L, T, R, B; } public struct POINT { public int X, Y; } public struct MI { public int cb; public RECT rcM; public RECT rcW; public uint f; }'
[S.W]::SetProcessDPIAware() | Out-Null
$h = [System.IntPtr]::Zero
$n = '${exe}'
if ($n) { $p = Get-Process -Name $n | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1; if ($p) { $h = $p.MainWindowHandle } }
if ($h -eq [System.IntPtr]::Zero) { $h = [S.W]::GetForegroundWindow() }
if ([S.W]::IsIconic($h)) { exit }
$r = New-Object S.W+RECT; [S.W]::GetClientRect($h, [ref]$r) | Out-Null
$pt = New-Object S.W+POINT; [S.W]::ClientToScreen($h, [ref]$pt) | Out-Null
$m = [S.W]::MonitorFromWindow($h, 2); $mi = New-Object S.W+MI; $mi.cb = 40; [S.W]::GetMonitorInfo($m, [ref]$mi) | Out-Null
'{"x":' + $pt.X + ',"y":' + $pt.Y + ',"w":' + ($r.R - $r.L) + ',"h":' + ($r.B - $r.T) + ',"mx":' + $mi.rcM.L + ',"my":' + $mi.rcM.T + ',"mw":' + ($mi.rcM.R - $mi.rcM.L) + ',"mh":' + ($mi.rcM.B - $mi.rcM.T) + '}'`;
  return new Promise(res => execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { windowsHide: true, timeout: 8000 }, (e, out) => {
    try { const j = JSON.parse(String(out || "").trim().split(/\r?\n/).pop()); res(j && j.w > 0 ? j : null); } catch { res(null); }
  }));
}
// drag a file out of Sothis (clips, videos, music, photos) into Discord, a folder or any app
const DRAG_RE = /\.(mp4|mkv|webm|mov|m4v|mp3|wav|m4a|png|jpe?g|gif|webp|bmp)$/i;
let dragIcon = null;
ipcMain.on("file:drag", (e, f) => {
  try {
    f = String(f || "");
    if (!DRAG_RE.test(f) || !path.isAbsolute(f) || !fs.existsSync(f) || !fs.statSync(f).isFile()) return;
    if (!dragIcon) dragIcon = nativeImage.createFromPath(path.join(__dirname, "icon.png")).resize({ width: 48, height: 48 });
    e.sender.startDrag({ file: f, icon: dragIcon });
  } catch {}
});
ipcMain.on("clip:audioRes", (_e, r) => { const f = r && audioReqs[r.id]; if (f) { delete audioReqs[r.id]; f(r); } });
ipcMain.handle("clips:state", () => clipper().state());
ipcMain.handle("clips:setup", async () => { const ok = await clipper().ffEnsure(); if (ok && sess) clipper().start(); return clipper().state(); });
ipcMain.handle("clips:save", () => clipper().save());
ipcMain.handle("clips:set", (_e, o) => {
  const cur = Object.assign({}, settings.clips || {}), was = JSON.stringify(cur);
  const k = ["on", "len", "key", "overlay", "mic", "fps", "monitor", "sysVol", "micVol", "sysMute", "micMute", "window", "audioOffset", "noise", "hideSothis"];
  for (const x of k) if (o && x in o) cur[x] = o[x];
  for (const x of ["sysVol", "micVol"]) cur[x] = Math.max(0, Math.min(200, Math.round(+cur[x] >= 0 ? +cur[x] : 100)));
  for (const x of ["sysMute", "micMute"]) cur[x] = !!cur[x];
  cur.audioOffset = Math.max(-1000, Math.min(1000, Math.round(+cur.audioOffset || 0)));
  cur.noise = ["off", "standard", "strong"].includes(cur.noise) ? cur.noise : "strong";
  cur.hideSothis = cur.hideSothis !== false;
  cur.len = [15, 30, 60, 120].includes(+cur.len) ? +cur.len : 30;
  if (!/^(F([6-9]|1[0-2])|Mouse4|Mouse5)$/.test(cur.key || "")) cur.key = "F8";
  cur.fps = +cur.fps === 30 ? 30 : 60;
  settings.clips = cur;
  if (/^F/.test(cur.key)) settings.medalKey = cur.key;   // keeps the Siege scoreboard key off the clip key
  saveSettings(); try { r6RegisterKey(); } catch {}
  const C = clipper(), s = C.state();
  const restartNeeded = ["fps", "monitor", "mic"].some(x => JSON.parse(was || "{}")[x] !== cur[x]);
  if (cur.on === false) C.stop(); else if (sess && !s.recording) C.start(); else if (restartNeeded) C.restart(); else C.applyAudio();
  try { clipHideApply(); } catch {}
  return C.state();
});
// Clips Medal saved loose in the main clips folder go into the folder of the game you were playing then
// (from Sothis's game sessions), so they're grouped and named like the rest
function clipsSortLoose() {
  try {
    const root = clipsDir(); if (!root || !fs.existsSync(root)) return 0;
    const hist = (settings.sessHist || []).slice();
    if (sess) hist.push({ game: sess.game, start: sess.start, end: Date.now() });
    if (!hist.length) return 0;
    let moved = 0;
    for (const e of fs.readdirSync(root, { withFileTypes: true })) {
      if (!e.isFile() || !VID_RE.test(e.name)) continue;
      const f = path.join(root, e.name); let st; try { st = fs.statSync(f); } catch { continue; }
      if (Date.now() - st.mtimeMs < 90000) continue;   // Medal may still be writing it
      const h = hist.find(x => st.mtimeMs >= x.start - 60000 && st.mtimeMs <= x.end + 3 * 60000);
      if (!h || !h.game) continue;
      const dir = path.join(root, String(h.game).replace(/[<>:"/\\|?*]/g, "").trim()); if (!dir || dir === root) continue;
      try { fs.mkdirSync(dir, { recursive: true }); } catch {}
      let to = path.join(dir, e.name);
      for (let i = 2; fs.existsSync(to); i++) to = path.join(dir, path.basename(e.name, path.extname(e.name)) + ` (${i})` + path.extname(e.name));
      try { fs.renameSync(f, to); moved++; } catch {}
    }
    if (moved) presLog("clips: moved " + moved + " loose clip" + (moved === 1 ? "" : "s") + " into game folders");
    return moved;
  } catch { return 0; }
}
ipcMain.handle("clips:list", async () => {
  clipsSortLoose();
  const dir = clipsDir(), items = [];
  const walk = (d, depth) => {
    let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { if (depth < 2 && !/^(thumbnails|screenshots|\.)/i.test(e.name)) walk(f, depth + 1); continue; }
      if (!VID_RE.test(e.name)) continue;
      try { const st = fs.statSync(f); items.push({ name: e.name.replace(VID_RE, ""), path: f, url: require("url").pathToFileURL(f).href, size: st.size, at: st.mtimeMs, game: depth ? path.basename(d) : "" }); } catch {}
    }
  };
  walk(dir, 0);
  items.sort((a, b) => b.at - a.at);
  return { dir, exists: fs.existsSync(dir), items: items.slice(0, 300) };
});
// Clip editor: trims and cuts with the ffmpeg that comes with Medal
function medalTools() {
  try { const own = clipper().ffExe(); if (own) { const pr = path.join(path.dirname(own), "ffprobe.exe"); return { ffmpeg: own, ffprobe: fs.existsSync(pr) ? pr : "" }; } } catch {}
  const base = path.join(process.env.LOCALAPPDATA || "", "Medal");
  let dirs = []; try { dirs = fs.readdirSync(base).filter(d => /^recorder-/i.test(d)).sort().reverse(); } catch {}
  for (const d of dirs) {
    const ff = ["ffmpeg7.exe", "ffmpeg.exe"].map(x => path.join(base, d, x)).find(x => fs.existsSync(x));
    if (ff) return { ffmpeg: ff, ffprobe: [path.join(base, d, "ffprobe.exe")].find(x => fs.existsSync(x)) || "" };
  }
  return null;
}
const runFF = (exe, args, onTime) => new Promise(resolve => {
  const p = require("child_process").spawn(exe, args, { windowsHide: true });
  let err = "";
  p.stderr.on("data", d => { const t = String(d); err = (err + t).slice(-4000); const m = t.match(/time=(\d+):(\d+):([\d.]+)/); if (m && onTime) onTime(+m[1] * 3600 + +m[2] * 60 + +m[3]); });
  p.on("error", e => resolve({ ok: false, err: String(e.message || e) }));
  p.on("close", code => resolve({ ok: code === 0, err }));
});
// how many sound tracks a clip has: Sothis clips have 1 mix + game (+ mic), others usually just 1
async function clipTracks(file, tools) {
  tools = tools || medalTools();
  if (!tools || !tools.ffprobe) return 1;
  const r = await new Promise(res => execFile(tools.ffprobe, ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", file], { windowsHide: true, timeout: 15000 }, (err, so) => res(err ? null : String(so).trim())));
  return r === null ? 1 : r ? r.split(/\r?\n/).filter(Boolean).length : 0;
}
ipcMain.handle("clips:tracks", async (_e, file) => {
  if (typeof file !== "string" || !inDirs(file, [clipsDir(), dlDir("mp4")]) || !fs.existsSync(file)) return 0;
  return clipTracks(file);
});
ipcMain.handle("clips:export", async (e, { file, segs, quick, gameVol, micVol }) => {
  if (typeof file !== "string" || !inDirs(file, [clipsDir(), dlDir("mp4")]) || !fs.existsSync(file)) return { ok: false, err: "That clip isn't in your clips folder." };
  const tools = medalTools();
  if (!tools) return { ok: false, err: "Couldn't find Medal's video tools. Is Medal installed?" };
  const parts = (Array.isArray(segs) ? segs : []).map(x => ({ a: Math.max(0, +x.a || 0), b: Math.max(0, +x.b || 0) })).filter(x => x.b - x.a > 0.05).sort((x, y) => x.a - y.a);
  if (!parts.length) return { ok: false, err: "Nothing left to save." };
  const total = parts.reduce((n, x) => n + x.b - x.a, 0);
  // named after the game and how many clips of it you have, e.g. "Overwatch 2 5.mp4" (the clip's game folder decides the game)
  const dirOf = path.dirname(file), root = path.resolve(clipsDir());
  const gameName = path.resolve(dirOf) !== root && path.resolve(dirOf).startsWith(root) ? path.basename(dirOf).replace(/[<>:"/\\|?*]/g, "").trim() : "";
  const base = gameName || "Clip";
  let count = 0; try { count = fs.readdirSync(dirOf).filter(n => VID_RE.test(n)).length; } catch {}
  let n = count + 1, out = path.join(dirOf, `${base} ${n}.mp4`);
  while (fs.existsSync(out)) out = path.join(dirOf, `${base} ${++n}.mp4`);
  const progress = t => { try { e.sender.send("clips:progress", Math.min(99, Math.round(t / total * 100))); } catch {} };
  // sound: tracks of a Sothis clip are 1 mix, 2 game, 3 mic; the editor's volumes remix them
  const nA = await clipTracks(file, tools), hasAudio = nA > 0;
  const gv = Math.max(0, Math.min(2, isFinite(+gameVol) ? +gameVol : 1)), mv = Math.max(0, Math.min(2, isFinite(+micVol) ? +micVol : 1));
  const volChanged = Math.abs(gv - 1) > 0.001 || Math.abs(mv - 1) > 0.001;
  if (quick && parts.length === 1 && !volChanged) {   // no re-encode: instant, but the cut lands on the nearest keyframe
    const r = await runFF(tools.ffmpeg, ["-hide_banner", "-y", "-ss", String(parts[0].a), "-to", String(parts[0].b), "-i", file, "-map", "0", "-c", "copy", "-avoid_negative_ts", "make_zero", "-movflags", "+faststart", out], progress);
    return r.ok ? { ok: true, out, name: path.basename(out) } : { ok: false, err: "ffmpeg: " + r.err.split("\n").filter(Boolean).slice(-2).join(" ") };
  }
  // the new clip keeps the same tracks (mix + game + mic), with the mix redone at the editor's volumes
  const nOut = nA >= 3 ? 3 : nA === 2 ? 2 : nA ? 1 : 0;
  let fc = "";
  parts.forEach((x, i) => {
    const tr = `trim=start=${x.a.toFixed(3)}:end=${x.b.toFixed(3)}`;
    fc += `[0:v:0]${tr},setpts=PTS-STARTPTS[v${i}];`;
    if (nOut === 1) fc += `[0:a:0]a${tr},asetpts=PTS-STARTPTS,volume=${gv.toFixed(2)}[a${i}x0];`;
    if (nOut >= 2) {
      fc += `[0:a:1]a${tr},asetpts=PTS-STARTPTS,asplit=2[g${i}a][a${i}x1];[g${i}a]volume=${gv.toFixed(2)}[g${i}v];`;
      if (nOut === 3) fc += `[0:a:2]a${tr},asetpts=PTS-STARTPTS,asplit=2[m${i}a][a${i}x2];[m${i}a]volume=${mv.toFixed(2)},pan=stereo|c0=c0|c1=c0[m${i}v];[g${i}v][m${i}v]amix=inputs=2:normalize=0:duration=first[a${i}x0];`;
      else fc += `[g${i}v]anull[a${i}x0];`;
    }
  });
  fc += parts.map((_, i) => `[v${i}]` + Array.from({ length: nOut }, (_, k) => `[a${i}x${k}]`).join("")).join("") + `concat=n=${parts.length}:v=1:a=${nOut}[v]` + Array.from({ length: nOut }, (_, k) => `[ao${k}]`).join("");
  const amaps = [];
  for (let k = 0; k < nOut; k++) amaps.push("-map", `[ao${k}]`);
  if (nOut >= 2) amaps.push("-metadata:s:a:0", "title=Mix", "-metadata:s:a:1", "title=Game", "-disposition:a:0", "default", "-disposition:a:1", "0");
  if (nOut === 3) amaps.push("-metadata:s:a:2", "title=Mic", "-disposition:a:2", "0");
  const ENC = [
    ["-c:v", "h264_amf", "-quality", "quality", "-rc", "cqp", "-qp_i", "18", "-qp_p", "20", "-qp_b", "22"],   // your Radeon card
    ["-c:v", "h264_nvenc", "-preset", "p5", "-cq", "19"],
    ["-c:v", "h264_qsv", "-global_quality", "20"],
    ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18"],
    ["-c:v", "h264_mf", "-b:v", "20M"]
  ];
  let last = "";
  for (const enc of ENC) {
    const r = await runFF(tools.ffmpeg, ["-hide_banner", "-y", "-i", file, "-filter_complex", fc, "-map", "[v]", ...amaps,
      ...enc, "-pix_fmt", "yuv420p", ...(hasAudio ? ["-c:a", "aac", "-b:a", "192k"] : []), "-movflags", "+faststart", out], progress);
    if (r.ok) return { ok: true, out, name: path.basename(out) };
    last = r.err;
    try { fs.unlinkSync(out); } catch {}
  }
  return { ok: false, err: "ffmpeg: " + last.split("\n").filter(Boolean).slice(-2).join(" ") };
});
ipcMain.handle("clips:choose", async () => {
  const r = await dialog.showOpenDialog(win, { title: "Pick your clips folder", defaultPath: clipsDir(), properties: ["openDirectory"] });
  if (!r.canceled && r.filePaths && r.filePaths[0]) { settings.clipsDir = r.filePaths[0]; saveSettings(); }
  return clipsDir();
});
ipcMain.handle("clips:delete", async (_e, f) => {
  if (typeof f !== "string" || !inDirs(f, [clipsDir(), dlDir("mp4")]) || !VID_RE.test(f) || !fs.existsSync(f)) return { ok: false, err: "That clip isn't in your clips folder." };
  try { await shell.trashItem(f); return { ok: true }; }   // goes to the Recycle Bin, so it can be restored
  catch (e) { return { ok: false, err: String(e.message || e) }; }
});
ipcMain.handle("web:showDl", (_e, f) => { if (typeof f === "string" && inDirs(f, [app.getPath("downloads")]) && fs.existsSync(f)) shell.showItemInFolder(f); return true; });
ipcMain.handle("clips:show", (_e, f) => { if (typeof f === "string" && inDirs(f, SOTHIS_DIRS())) shell.showItemInFolder(f); return true; });
ipcMain.handle("medal:folder", async () => {
  const dir = clipsDir();
  const err = await shell.openPath(fs.existsSync(dir) ? dir : app.getPath("videos"));
  return !err;
});
ipcMain.handle("medal:key", (_e, key) => {
  if (MEDAL_KEYS.includes(key)) { settings.medalKey = key; saveSettings(); r6RegisterKey(); }
  return { key: medalKey(), r6: r6Key() };
});

/* ---------- Games tab: find installed Steam, Battle.net and Ubisoft games and launch them ---------- */
function regQuery(key, value) {
  return new Promise(res => {
    if (process.platform !== "win32") return res(null);
    execFile("reg", ["query", key, ...(value ? ["/v", value] : [])], { windowsHide: true, timeout: 4000 }, (err, out) => {
      if (err) return res(null);
      if (!value) return res(out);
      const mm = String(out).match(new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s+REG_\\w+\\s+(.+)", "i"));
      res(mm ? mm[1].trim() : null);
    });
  });
}
// Cover art Steam has already saved on this PC (works for new games whose web art has hashed names)
function steamLocalArt(root, id) {
  const cache = path.join(root, "appcache", "librarycache");
  const found = { tall: "", wide: "" };
  const pick = (file) => {
    const f = path.basename(file).toLowerCase();
    if (!found.tall && /(library_600x900|library_capsule|portrait)\.(jpg|png)$/.test(f)) found.tall = require("url").pathToFileURL(file).href;
    else if (!found.wide && /(header|library_hero|capsule_616x353)\.(jpg|png)$/.test(f)) found.wide = require("url").pathToFileURL(file).href;
  };
  try { // older Steam: flat files like 123_library_600x900.jpg
    if (fs.existsSync(path.join(cache, id + "_library_600x900.jpg"))) found.tall = found.tall || require("url").pathToFileURL(path.join(cache, id + "_library_600x900.jpg")).href;
    if (fs.existsSync(path.join(cache, id + "_header.jpg"))) found.wide = found.wide || require("url").pathToFileURL(path.join(cache, id + "_header.jpg")).href;
  } catch {}
  try { // newer Steam: librarycache/<appid>/[hash/]file.jpg
    const dir = path.join(cache, id);
    const walk = (d, depth) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory() && depth < 2) walk(p, depth + 1); else if (e.isFile()) pick(p); } };
    if (fs.existsSync(dir)) walk(dir, 0);
  } catch {}
  return found;
}
// Last resort: the store page's header image (has the right hashed address)
ipcMain.handle("games:storeArt", async (_e, id) => {
  if (!/^\d+$/.test(String(id))) return "";
  try {
    const r = await fetch(`https://store.steampowered.com/api/appdetails?appids=${id}&filters=basic`);
    const j = await r.json();
    const d = j && j[id] && j[id].data;
    return (d && (d.header_image || d.capsule_imagev5 || d.capsule_image)) || "";
  } catch { return ""; }
});
const STEAM_SKIP = /redistributable|steamworks|steam linux runtime|proton|dedicated server|soundtrack|\bsdk\b|benchmark|wallpaper engine/i;
async function steamGames() {
  let root = await regQuery("HKCU\\Software\\Valve\\Steam", "SteamPath");
  if (!root) root = "C:\\Program Files (x86)\\Steam";
  root = root.replace(/\//g, "\\");
  const libs = new Set([path.join(root, "steamapps")]);
  try {
    const vdf = fs.readFileSync(path.join(root, "steamapps", "libraryfolders.vdf"), "utf8");
    for (const mm of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libs.add(path.join(mm[1].replace(/\\\\/g, "\\"), "steamapps"));
  } catch {}
  const out = [];
  for (const lib of libs) {
    let files = [];
    try { files = fs.readdirSync(lib).filter(f => /^appmanifest_\d+\.acf$/.test(f)); } catch { continue; }
    for (const f of files) {
      try {
        const acf = fs.readFileSync(path.join(lib, f), "utf8");
        const id = (acf.match(/"appid"\s+"(\d+)"/) || [])[1], name = (acf.match(/"name"\s+"([^"]+)"/) || [])[1];
        const flags = +((acf.match(/"StateFlags"\s+"(\d+)"/) || [])[1] || 4);
        if (!id || !name || STEAM_SKIP.test(name) || !(flags & 4)) continue;
        const played = +((acf.match(/"LastPlayed"\s+"(\d+)"/) || [])[1] || 0);
        const local = steamLocalArt(root, id);
        out.push({ key: "steam:" + id, appid: id, name, store: "Steam", launch: "steam://rungameid/" + id,
          art: local.tall || `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_600x900.jpg`,
          artAlt: local.wide || `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/header.jpg`, played: played * 1000 });
      } catch {}
    }
  }
  return out;
}
const BNET = [
  { key: "Overwatch", name: "Overwatch 2", code: "Pro", logo: "ow" },
  { key: "Diablo IV", name: "Diablo IV", code: "Fen" },
  { key: "Hearthstone", name: "Hearthstone", code: "WTCG" },
  { key: "World of Warcraft", name: "World of Warcraft", code: "WoW" },
  { key: "Call of Duty", name: "Call of Duty", code: "AUKS" }
];
async function otherGames() {
  const out = [], U = "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\";
  for (const g of BNET) {
    if (await regQuery(U + g.key, "DisplayName")) out.push({ key: "bnet:" + g.code, name: g.name, store: "Battle.net", launch: "battlenet://" + g.code, logo: g.logo || "", played: 0 });
  }
  // Rainbow Six Siege on Ubisoft Connect (the Steam copy shows up with Steam games)
  if (await regQuery("HKLM\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs\\635", "InstallDir"))
    out.push({ key: "ubi:635", name: "Rainbow Six Siege", store: "Ubisoft", launch: "uplay://launch/635/0", logo: "r6", played: 0 });
  return out;
}
let gamesCache = null;
ipcMain.handle("games:list", async (_e, force) => {
  if (gamesCache && !force) return gamesCache;
  const [a, b] = await Promise.all([steamGames().catch(() => []), otherGames().catch(() => [])]);
  const seen = new Set();
  gamesCache = [...b, ...a].filter(g => !seen.has(g.name.toLowerCase()) && seen.add(g.name.toLowerCase()));
  return gamesCache;
});
ipcMain.handle("games:launch", (_e, url) => {
  if (!/^(steam:\/\/rungameid\/\d+|battlenet:\/\/\w+|uplay:\/\/launch\/\d+\/\d+)$/.test(String(url))) return false;
  shell.openExternal(url);
  return true;
});

/* ---------- Live updates: files dropped into the install folder show an "Update ready" pill ---------- */
let updWatch = null, updT = null;
// Windows reports a file "changed" for antivirus scans, timestamp and attribute touches too, so only
// real content changes count: each file is fingerprinted at launch and re-checked when the watcher fires.
const updBase = new Map(), updDirty = new Set(), updSeen = new Set();
const RESTART_RE = /^(main|preload|toast-preload|obs-preload|r6tab-preload|sw-pop-preload|vo-preload|battery-worker|nopasskey-preload|qpop-preload|emu-preload|azahar-preload)\.js$/i;
const updHash = f => { try { return require("crypto").createHash("sha1").update(fs.readFileSync(path.join(__dirname, f))).digest("hex"); } catch { return "gone"; } };
function updScan(dir = "") {
  let ents = []; try { ents = fs.readdirSync(path.join(__dirname, dir), { withFileTypes: true }); } catch {}
  for (const e of ents) {
    const rel = path.join(dir, e.name);
    if (/node_modules/i.test(rel)) continue;
    if (e.isDirectory()) updScan(rel); else updBase.set(rel, updHash(rel));
  }
}
function updCheck() {
  for (const f of updSeen) {
    const h = updHash(f);
    if (h === (updBase.has(f) ? updBase.get(f) : "gone")) updDirty.delete(f); else updDirty.add(f);
  }
  updSeen.clear();
  if (!updDirty.size || !win || win.isDestroyed()) return;
  win.webContents.send("app:update", { restart: [...updDirty].some(f => RESTART_RE.test(path.basename(f))) });
}
function startUpdateWatch() {
  if (updWatch) return;
  try {
    updScan();
    updWatch = fs.watch(__dirname, { recursive: true }, (_ev, file) => {
      if (!file || /node_modules|\.tmp$|~$/i.test(file)) return;
      updSeen.add(path.normalize(file));
      clearTimeout(updT);
      updT = setTimeout(updCheck, 900);
    });
  } catch {}
}
ipcMain.on("app:reload", () => {
  // the page now runs the new page files; anything needing a restart stays pending
  for (const f of [...updDirty]) if (!RESTART_RE.test(path.basename(f))) { updBase.set(f, updHash(f)); updDirty.delete(f); }
  if (win && !win.isDestroyed()) win.webContents.reloadIgnoringCache();
});
ipcMain.on("app:restart", () => { quitting = true; flushSites(); const wait = dockReleaseAll(); setTimeout(() => { app.relaunch(); app.exit(0); }, wait); });

/* ---------- Modrinth App (opened from the Minecraft server badge) ---------- */
function modrinthPath() {
  const L = process.env.LOCALAPPDATA || "", P = process.env.ProgramFiles || "C:\\Program Files";
  const cands = [
    path.join(L, "Modrinth App", "Modrinth App.exe"),
    path.join(L, "Programs", "Modrinth App", "Modrinth App.exe"),
    path.join(P, "Modrinth App", "Modrinth App.exe"),
    path.join(L, "Modrinth App", "theseus_gui.exe")
  ];
  return cands.find(p => { try { return fs.existsSync(p); } catch { return false; } }) || "";
}
ipcMain.handle("modrinth:open", async () => {
  const exe = modrinthPath();
  if (exe) { try { require("child_process").spawn(exe, [], { detached: true, stdio: "ignore" }).unref(); return true; } catch {} }
  try { await shell.openExternal("modrinth://"); return true; } catch { return false; }
});

/* ---------- Volume mixer (per-app volume through a small PowerShell helper that stays running) ---------- */
let mix = null, mixBuf = "", mixQueue = [];
function mixStart() {
  if (mix || process.platform !== "win32") return;
  try {
    mix = require("child_process").spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "audio-helper.ps1")], { windowsHide: true });
  } catch { mix = null; return; }
  mix.stdout.setEncoding("utf8");
  mix.stdout.on("data", d => {
    mixBuf += d;
    let i;
    while ((i = mixBuf.indexOf("\n")) >= 0) {
      const line = mixBuf.slice(0, i).trim(); mixBuf = mixBuf.slice(i + 1);
      if (!line) continue;
      const job = mixQueue.shift();
      if (job) { clearTimeout(job.t); try { job.res(JSON.parse(line)); } catch { job.res(null); } }
    }
  });
  mix.on("exit", () => { mix = null; for (const j of mixQueue.splice(0)) { clearTimeout(j.t); j.res(null); } });
}
function mixCmd(cmd) {
  mixStart();
  if (!mix) return Promise.resolve(null);
  return new Promise(res => {
    const job = { res, t: setTimeout(() => { const k = mixQueue.indexOf(job); if (k >= 0) mixQueue.splice(k, 1); res(null); }, 15000) };
    mixQueue.push(job);
    mix.stdin.write(cmd + "\n");
  });
}
const mixIcons = {};
async function mixIcon(p) {
  if (!p) return "";
  if (mixIcons[p] !== undefined) return mixIcons[p];
  try { mixIcons[p] = (await app.getFileIcon(p, { size: "normal" })).toDataURL(); } catch { mixIcons[p] = ""; }
  return mixIcons[p];
}
ipcMain.handle("mix:list", async () => {
  const list = await mixCmd("list");
  if (!Array.isArray(list)) return null;
  const own = new Set([process.pid, ...app.getAppMetrics().map(x => x.pid)]);
  for (const a of list) { a.icon = await mixIcon(a.path); a.self = a.pids.some(p => own.has(p)); delete a.path; }
  return list;
});
ipcMain.handle("mix:set", (_e, { name, vol }) => mixCmd(`set ${Math.max(0, Math.min(1, Number(vol) || 0)).toFixed(3)} ${String(name).replace(/[\r\n]/g, "")}`));
ipcMain.handle("mix:mute", (_e, { name, mute }) => mixCmd(`mute ${mute ? 1 : 0} ${String(name).replace(/[\r\n]/g, "")}`));
app.on("will-quit", () => { try { mix && mix.kill(); } catch {} });

/* ---------- Launcher buttons: apps pinned to the corner, red while running ---------- */
const LAUNCH_PRESETS = () => {
  const L = process.env.LOCALAPPDATA || "", PF = process.env.ProgramFiles || "C:\\Program Files", PF86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  return [
    { name: "Opera GX", path: operaPath(), proc: "opera.exe", logo: "opera" },
    { name: "Medal", path: path.join(L, "Medal", "Update.exe"), alt: path.join(L, "Medal", "current", "medal.exe"), args: ["--processStart", "Medal.exe"], proc: "medal.exe" },
    { name: "OBS Studio", path: path.join(PF, "obs-studio", "bin", "64bit", "obs64.exe"), proc: "obs64.exe", cwd: true },
    { name: "Steam", path: path.join(PF86, "Steam", "steam.exe"), proc: "steam.exe" },
    { name: "Battle.net", path: path.join(PF86, "Battle.net", "Battle.net Launcher.exe"), proc: "battle.net.exe" },
    { name: "Modrinth App", path: modrinthPath(), proc: "modrinth app.exe" }
  ].filter(p => p.path && fs.existsSync(p.path));
};
function launchers() {
  if (!Array.isArray(settings.launchers)) {
    const op = LAUNCH_PRESETS().find(p => p.name === "Opera GX");
    settings.launchers = op ? [{ name: op.name, path: op.path, proc: op.proc, logo: "opera" }] : [];
  }
  return settings.launchers;
}
const launchIcons = {};
async function launchIcon(l) {
  if (l.logo) return "";
  const k = l.alt || l.path;
  if (launchIcons[k] === undefined) { try { launchIcons[k] = (await app.getFileIcon(k, { size: "large" })).toDataURL(); } catch { launchIcons[k] = ""; } }
  return launchIcons[k];
}
function runningSet() {
  return new Promise(res => {
    if (process.platform !== "win32") return res(new Set());
    execFile("tasklist", ["/FO", "CSV", "/NH"], { windowsHide: true, timeout: 5000, maxBuffer: 4 << 20 }, (err, out) => {
      const s = new Set();
      if (!err) for (const line of String(out).split(/\r?\n/)) { const mm = line.match(/^"([^"]+)"/); if (mm) s.add(mm[1].toLowerCase()); }
      res(s);
    });
  });
}
ipcMain.handle("launch:list", async () => {
  const run = await runningSet();
  const out = [];
  for (const [i, l] of launchers().entries()) {
    out.push({ i, name: l.name, logo: l.logo || "", icon: await launchIcon(l), running: run.has((l.proc || path.basename(l.path)).toLowerCase()) });
  }
  return out;
});
ipcMain.handle("launch:presets", () => {
  const have = new Set(launchers().map(l => l.path.toLowerCase()));
  return LAUNCH_PRESETS().filter(p => !have.has(p.path.toLowerCase())).map(p => ({ name: p.name }));
});
ipcMain.handle("launch:open", async (_e, i) => {
  const l = launchers()[i];
  if (!l) return false;
  if (/obs64\.exe$/i.test(l.proc || l.path)) {          // OBS button: open the OBS controls pop-out, start OBS if needed
    const running = (await runningSet()).has("obs64.exe");
    if (running) { toggleObsWin(); return true; }
    showObsWin();
  }
  try {
    require("child_process").spawn(l.path, l.args || [], { detached: true, stdio: "ignore", cwd: l.cwd ? path.dirname(l.path) : undefined }).unref();
    return true;
  } catch { return false; }
});
ipcMain.handle("launch:addPreset", (_e, name) => {
  const p = LAUNCH_PRESETS().find(x => x.name === name);
  if (!p) return false;
  launchers().push({ name: p.name, path: p.path, alt: p.alt, args: p.args, proc: p.proc, cwd: p.cwd, logo: p.logo });
  saveSettings(); return true;
});
ipcMain.handle("launch:addFile", async () => {
  const r = await dialog.showOpenDialog(win, { title: "Pick an app to pin", properties: ["openFile"], filters: [{ name: "Apps", extensions: ["exe", "lnk"] }] });
  if (r.canceled || !r.filePaths[0]) return false;
  let p = r.filePaths[0];
  if (/\.lnk$/i.test(p)) { try { p = shell.readShortcutLink(p).target || p; } catch {} }
  const name = path.basename(p).replace(/\.exe$/i, "");
  launchers().push({ name: name.charAt(0).toUpperCase() + name.slice(1), path: p });
  saveSettings(); return true;
});
ipcMain.handle("launch:remove", (_e, i) => { launchers().splice(i, 1); saveSettings(); return true; });
ipcMain.handle("launch:move", (_e, { i, dir }) => {
  const L = launchers(), j = i + dir;
  if (j < 0 || j >= L.length) return false;
  [L[i], L[j]] = [L[j], L[i]]; saveSettings(); return true;
});

/* ---------- Opera GX button: launch it, and report whether it's running ---------- */
function operaPath() {
  const cands = [
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Opera GX", "opera.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Opera GX", "launcher.exe"),
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Opera GX", "opera.exe")
  ];
  return cands.find(p => { try { return fs.existsSync(p); } catch { return false; } }) || "";
}
/* ---------- Apps docked inside Sothis (Discord, Opera GX): the app's real window, put inside a holder window
   that sits exactly over the matching Sothis page and follows it around ---------- */
function discordExe() {
  const L = process.env.LOCALAPPDATA || "";
  const upd = path.join(L, "Discord", "Update.exe");
  return fs.existsSync(upd) ? upd : "";
}
const DOCK_CFG = {
  opera: { name: "Opera GX", exe: () => operaPath(), args: "--new-window", proc: "opera", any: false },
  // Discord keeps its own window (never re-parented), so closing Sothis just hands it back and your call carries on
  discord: { name: "Discord", exe: () => discordExe(), args: "--processStart Discord.exe", proc: "Discord", any: true, overlay: true }
};
const docks = {};
function dk(key) {
  if (!DOCK_CFG[key]) return null;
  return docks[key] || (docks[key] = { key, host: null, helper: null, rect: null, shown: false, state: "" });
}
const dockTell = (d, st) => { d.state = st; if (win && !win.isDestroyed()) { win.webContents.send("dock:state", { key: d.key, state: st }); if (d.key === "opera") win.webContents.send("opera:state", st); } };
function dockSend(d, line) { try { d.helper && d.helper.stdin.write(line + "\n"); } catch {} }
function dockPlace(d) {
  if (DOCK_CFG[d.key].overlay) {
    if (!win || win.isDestroyed() || !d.rect) return;
    const cb = win.getContentBounds();
    let r = { x: Math.round(cb.x + d.rect.x), y: Math.round(cb.y + d.rect.y), width: Math.max(50, Math.round(d.rect.w)), height: Math.max(50, Math.round(d.rect.h)) };
    try { if (process.platform === "win32") r = screen.dipToScreenRect(win, r); } catch {}
    dockSend(d, `move ${r.x} ${r.y} ${r.width} ${r.height}`); d.placed = true;
    return;
  }
  if (!d.host || d.host.isDestroyed() || !win || win.isDestroyed() || !d.rect) return;
  const cb = win.getContentBounds();
  const b = { x: Math.round(cb.x + d.rect.x), y: Math.round(cb.y + d.rect.y), width: Math.max(50, Math.round(d.rect.w)), height: Math.max(50, Math.round(d.rect.h)) };
  d.host.setBounds(b);
  const sf = screen.getDisplayMatching(b).scaleFactor || 1;
  dockSend(d, `move 0 0 ${Math.round(b.width * sf)} ${Math.round(b.height * sf)}`);
}
function dockEnsureHost(d) {
  if (d.host && !d.host.isDestroyed()) return;
  const name = DOCK_CFG[d.key].name;
  d.host = new BrowserWindow({ parent: win, frame: false, show: false, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, backgroundColor: "#121016", hasShadow: false, focusable: true, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  d.host.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(`<body style="margin:0;background:#121016;color:#a7abb9;font:14px Segoe UI,sans-serif;display:grid;place-items:center;height:100vh">Opening ${name}…</body>`));
  d.host.on("closed", () => { d.host = null; try { d.helper && d.helper.kill(); } catch {} d.helper = null; });
  d.host.on("focus", () => dockSend(d, "focus"));
}
function dockStart(d) {
  if (d.helper) return;
  const cfg = DOCK_CFG[d.key], exe = cfg.exe();
  if (!exe) { dockTell(d, "noapp"); return; }
  if (!cfg.overlay) dockEnsureHost(d);
  const hb = (cfg.overlay ? win : d.host).getNativeWindowHandle();
  const hwnd = hb.length >= 8 ? hb.readBigUInt64LE(0).toString() : String(hb.readUInt32LE(0));
  try {
    d.helper = require("child_process").spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "dock-window.ps1"),
      "-Parent", hwnd, "-Exe", exe, "-AppArgs", cfg.args, "-Proc", cfg.proc, ...(cfg.any ? ["-AnyWindow"] : []), ...(cfg.overlay ? ["-Overlay"] : [])], { windowsHide: true });
  } catch { dockTell(d, "failed"); return; }
  dockTell(d, "starting");
  let buf = "";
  d.helper.stdout.setEncoding("utf8");
  d.helper.stdout.on("data", x => {
    buf += x; const ls = buf.split(/\r?\n/); buf = ls.pop();
    for (const l0 of ls) {
      const l = l0.trim();
      if (l.startsWith("embedded")) { dockTell(d, "embedded"); dockPlace(d); dockFollow(d); }
      else if (l === "noapp") dockTell(d, "noapp");
      else if (l === "hidden") { d.placed = false; dockTell(d, "hidden"); if (d.host && !d.host.isDestroyed()) d.host.hide(); }
      else if (l === "shown") { dockTell(d, "embedded"); dockFollow(d); }
      else if (l === "gone" || l === "released") { d.helper = null; dockTell(d, l === "gone" ? "closed" : "released"); if (d.host && !d.host.isDestroyed()) d.host.hide(); }
    }
  });
  d.helper.on("exit", () => { d.helper = null; if (d.state === "starting") dockTell(d, "failed"); });
}
function dockFollow(d) {
  if (DOCK_CFG[d.key].overlay) {
    const want = !settings.mini && !settings.compact && d.shown && win && !win.isDestroyed() && win.isVisible() && !win.isMinimized() && d.state === "embedded";
    if (want) dockPlace(d); else if (d.placed) { dockSend(d, "hide"); d.placed = false; }
    return;
  }
  if (!d.host || d.host.isDestroyed()) return;
  if (settings.mini || settings.compact || !d.shown || !win || !win.isVisible() || win.isMinimized() || d.state !== "embedded" && d.state !== "starting") { if (d.host.isVisible()) d.host.hide(); return; }
  dockPlace(d); if (!d.host.isVisible()) d.host.showInactive();
}
function dockReleaseAll() {
  let any = false;
  for (const k of Object.keys(docks)) { const d = docks[k]; if (d.helper) { any = true; dockSend(d, "release"); } }
  return any ? 1200 : 0;
}
const dockFollowAll = () => { for (const k of Object.keys(docks)) try { dockFollow(docks[k]); } catch {} };
ipcMain.handle("dock:show", (_e, key, r) => {
  const d = dk(key); if (!d) return "";
  if (r && isFinite(r.x)) d.rect = { x: r.x, y: r.y, w: r.w, h: r.h };
  d.shown = true;
  if (d.state === "hidden") { d.state = "starting"; try { d.helper && d.helper.kill(); } catch {} d.helper = null; }
  if (!d.helper) dockStart(d);
  dockFollow(d);
  return d.state;
});
ipcMain.on("dock:move", (_e, key, r) => { const d = dk(key); if (d && r && isFinite(r.x)) { d.rect = { x: r.x, y: r.y, w: r.w, h: r.h }; dockFollow(d); } });
ipcMain.on("dock:hide", (_e, key) => { const d = dk(key); if (!d) return; d.shown = false; dockFollow(d); });
ipcMain.on("dock:release", (_e, key) => { const d = dk(key); if (d) dockSend(d, "release"); });
ipcMain.handle("dock:restart", (_e, key) => { const d = dk(key); if (!d) return false; try { d.helper && d.helper.kill(); } catch {} d.helper = null; d.state = ""; dockStart(d); dockFollow(d); return true; });
// the Opera page from before uses the same thing
ipcMain.handle("opera:show", (_e, r) => { const d = dk("opera"); if (r && isFinite(r.x)) d.rect = { x: r.x, y: r.y, w: r.w, h: r.h }; d.shown = true; if (!d.helper) dockStart(d); dockFollow(d); return d.state; });
ipcMain.on("opera:move", (_e, r) => { const d = dk("opera"); if (r && isFinite(r.x)) { d.rect = { x: r.x, y: r.y, w: r.w, h: r.h }; dockFollow(d); } });
ipcMain.on("opera:hide", () => { const d = dk("opera"); d.shown = false; dockFollow(d); });
ipcMain.on("opera:release", () => dockSend(dk("opera"), "release"));
ipcMain.handle("opera:restart", () => { const d = dk("opera"); d.state = ""; dockStart(d); dockFollow(d); return true; });
ipcMain.handle("opera:open", () => {
  const exe = operaPath();
  if (!exe) return false;
  try { require("child_process").spawn(exe, [], { detached: true, stdio: "ignore", windowsHide: false }).unref(); return true; } catch { return false; }
});
// Open a GX page in Opera GX (where you're signed in to GX Rewards), e.g. the Overwatch rewards page
ipcMain.handle("opera:url", (_e, url) => {
  if (!/^https:\/\/(gx\.me|operagx\.gg)\//i.test(String(url || ""))) return false;
  const exe = operaPath();
  if (!exe) { shell.openExternal(url); return true; }
  try { require("child_process").spawn(exe, [url], { detached: true, stdio: "ignore", windowsHide: false }).unref(); return true; } catch { return false; }
});
ipcMain.handle("opera:running", () => new Promise(res => {
  if (process.platform !== "win32") return res(false);
  execFile("tasklist", ["/FI", "IMAGENAME eq opera.exe", "/NH"], { windowsHide: true, timeout: 4000 }, (err, out) => res(!err && /opera\.exe/i.test(String(out))));
}));

/* ---------- Song pop-up (small pill above the taskbar on each new song) ---------- */
const TOAST = { w: 380, h: 76 };
let toastWin = null, toastReady = false, toastKey = "", toastShowing = false, toastPending = null;
function ensureToastWin() {
  if (toastWin && !toastWin.isDestroyed()) return toastWin;
  toastReady = false;
  toastWin = new BrowserWindow({
    width: TOAST.w, height: TOAST.h, show: false, frame: false, transparent: true, resizable: false,
    movable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true,
    focusable: false, hasShadow: false, alwaysOnTop: true, backgroundColor: "#00000000",
    webPreferences: { preload: path.join(__dirname, "toast-preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  toastWin.setAlwaysOnTop(true, "screen-saver");
  toastWin.setVisibleOnAllWorkspaces(true);
  toastWin.loadFile(path.join(__dirname, "toast.html"));
  toastWin.webContents.on("did-finish-load", () => {
    toastReady = true;
    if (toastPending) { const p = toastPending; toastPending = null; showSongToast(p); }
  });
  toastWin.on("closed", () => { toastWin = null; toastReady = false; toastShowing = false; });
  return toastWin;
}
function placeToast() {
  const area = screen.getPrimaryDisplay().workArea;
  toastWin.setBounds({ x: area.x + area.width - TOAST.w - 4, y: area.y + area.height - TOAST.h - 8, width: TOAST.w, height: TOAST.h });
}
function showSongToast(d) {
  const tw = ensureToastWin();
  if (!toastReady) { toastPending = d; return; }
  placeToast();
  tw.webContents.executeJavaScript(`window.songToast(${JSON.stringify(d)}, 4000)`).catch(() => {});
  if (!d.update) { tw.showInactive(); tw.setAlwaysOnTop(true, "screen-saver"); toastShowing = true; }
}
function maybeSongToast() {
  if (settings.songToast === false || !player.connected || !player.title) return;
  const key = player.title + "\u0000" + (player.artist || "");
  const data = { title: player.title, artist: player.artist, art: player.art || "" };
  if (key === toastKey) {
    // cover art often arrives a moment after the title
    if (toastShowing && data.art) showSongToast(Object.assign(data, { update: true }));
    return;
  }
  if (!player.playing) return;
  toastKey = key;
  // No need when the full window is right in front of you
  if (win && !win.isDestroyed() && win.isVisible() && win.isFocused() && !settings.mini) return;
  showSongToast(data);
}
ipcMain.on("toast:done", () => { toastShowing = false; if (toastWin && !toastWin.isDestroyed()) toastWin.hide(); });
ipcMain.on("toast:click", () => { toastShowing = false; if (toastWin && !toastWin.isDestroyed()) toastWin.hide(); showWindow(); });
ipcMain.handle("toast:enabled", (_e, on) => { settings.songToast = !!on; saveSettings(); broadcast(); return settings.songToast; });
ipcMain.on("toast:test", () => showSongToast({ title: player.title || "Song pop-up is on", artist: player.title ? player.artist : "You'll see this on each new song", art: player.art || "" }));

function refreshTray() {
  if (!tray) return;
  const visible = win && !win.isDestroyed() && win.isVisible();
  const on = player.connected;
  const vol = Math.round(player.volume * 100);
  const esc = t => String(t || "").replace(/&/g, "&&");
  const nowPlaying = on && player.title ? (player.title + (player.artist ? " — " + player.artist : "")) : "";
  const levels = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  const nearest = levels.reduce((a, b) => Math.abs(b - vol) < Math.abs(a - vol) ? b : a, 0);
  tray.setContextMenu(Menu.buildFromTemplate([
    ...(nowPlaying ? [{ label: esc(nowPlaying.length > 48 ? nowPlaying.slice(0, 47) + "…" : nowPlaying), enabled: false }, { type: "separator" }] : []),
    { label: player.playing ? "Pause" : "Play", enabled: on, click: () => remote("playpause") },
    { label: "Next", enabled: on, click: () => remote("next") },
    { label: "Previous", enabled: on, click: () => remote("prev") },
    {
      label: `Volume (${vol}%)`, enabled: on, submenu: [
        { label: "Volume up", click: () => remote("volstep", 0.1) },
        { label: "Volume down", click: () => remote("volstep", -0.1) },
        { type: "separator" },
        ...levels.slice().reverse().map(v => ({ label: v === 0 ? "Mute" : v + "%", type: "radio", checked: v === nearest, click: () => remote("vol", v / 100) }))
      ]
    },
    ...(dc.status === "ok" ? [
      { type: "separator" },
      { label: "Discord mute", type: "checkbox", checked: !!(dc.vs && dc.vs.mute), click: () => dcToggle("mute") },
      { label: "Discord deafen", type: "checkbox", checked: !!(dc.vs && dc.vs.deaf), click: () => dcToggle("deaf") }
    ] : []),
    { type: "separator" },
    { label: "OBS controls", click: () => showObsWin() },
    { label: visible ? "Hide Sothis" : "Show Sothis", click: () => visible ? win.hide() : showWindow() },
    { label: "Always on top", type: "checkbox", checked: isPinned(), click: i => setPinned(i.checked) },
    { label: "Mini player", type: "checkbox", checked: !!settings.mini, click: i => { setMini(i.checked); showWindow(); } },
    { label: "Open at startup", type: "checkbox", checked: isStartup(), click: i => setStartup(i.checked) },
    { type: "separator" },
    { label: "Quit", click: () => { quitting = true; app.quit(); } }
  ]));
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, "tray.png")));
  tray.setToolTip("Sothis");
  tray.on("click", () => (win.isVisible() && win.isFocused()) ? win.hide() : showWindow());
  refreshTray();
}


/* ---------- Mouse battery ---------- */
const BATTERY_INTERVAL = 120000;
const BATTERY_TIMEOUT = 8000;
let battery = { state: "checking" };
let worker = null;
let pending = null;
let alerted = { 20: false, 10: false };

function startWorker() {
  const w = utilityProcess.fork(path.join(__dirname, "battery-worker.js"), [], { serviceName: "Mouse battery" });
  worker = w;
  w.on("message", m => { if (worker === w) finishRead(m); });
  w.on("exit", () => {
    if (worker !== w) return;
    worker = null;
    finishRead({ state: "error", message: "Device access failed. Wake the mouse and refresh." });
  });
}

function finishRead(result) {
  if (!pending) return;
  clearTimeout(pending.timer);
  const p = pending;
  pending = null;
  p.resolve(result);
}

function readBattery() {
  if (pending) return pending.promise;
  if (!worker) startWorker();
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  pending = {
    promise, resolve,
    timer: setTimeout(() => {
      if (worker) { worker.kill(); worker = null; }
      finishRead({ state: "error", message: "The mouse took too long to answer. Wake it and refresh." });
    }, BATTERY_TIMEOUT)
  };
  worker.postMessage("read");
  return promise;
}

async function refreshBattery() {
  if (battery.state !== "ok") { battery = Object.assign({}, battery, { checking: true }); sendBattery(); }
  const r = await readBattery();
  // Keep the last good percentage visible if the mouse dozes off between checks.
  if (r.state === "asleep" && battery.state === "ok") {
    battery = Object.assign({}, battery, { stale: true, at: battery.at, checking: false });
  } else {
    battery = Object.assign({}, r, { at: Date.now(), checking: false });
  }
  if (r.state === "ok") { lowBatteryAlert(r); recordBattery(r); }
  sendBattery();
  return battery;
}

/* Battery history (last 7 days) for the hover pop-up */
const battHistFile = () => path.join(app.getPath("userData"), "battery-history.json");
let battHist = null;
function loadBattHist() {
  if (battHist) return battHist;
  try { battHist = JSON.parse(fs.readFileSync(battHistFile(), "utf8")); } catch { battHist = []; }
  if (!Array.isArray(battHist)) battHist = [];
  return battHist;
}
function recordBattery(r) {
  const h = loadBattHist(), now = Date.now(), last = h[h.length - 1];
  const p = Math.round(r.percent), c = !!r.charging;
  // one point every 10 minutes, or right away when the level or charging changes
  if (last && now - last.t < 10 * 60000 && last.p === p && last.c === c) return;
  h.push({ t: now, p, c });
  const cutoff = now - 7 * 864e5;
  while (h.length && h[0].t < cutoff) h.shift();
  try { fs.writeFileSync(battHistFile(), JSON.stringify(h)); } catch {}
}
function battEstimate(h) {
  const cur = h[h.length - 1];
  if (!cur) return null;
  if (cur.c) return { charging: true };
  // walk back through the current stretch on battery
  let i = h.length - 1;
  while (i > 0 && !h[i - 1].c && h[i - 1].p >= h[i].p - 1 && cur.t - h[i - 1].t < 72 * 36e5) i--;
  const first = h[i], hrs = (cur.t - first.t) / 36e5, drop = first.p - cur.p;
  if (hrs < 2 || drop < 3) return { learning: true };
  const rate = drop / hrs;
  return { hoursLeft: cur.p / rate, rate };
}
ipcMain.handle("battery:history", () => { const h = loadBattHist(); return { points: h, estimate: battEstimate(h) }; });

function sendBattery() {
  if (win && !win.isDestroyed()) win.webContents.send("battery:state", battery);
  if (tray) {
    const b = battery.state === "ok" ? `Mouse ${battery.percent}%${battery.charging ? " (charging)" : ""}` : "";
    tray.setToolTip("Sothis");
  }
}

function lowBatteryAlert(r) {
  if (r.charging || r.percent > 25) { alerted = { 20: false, 10: false }; return; }
  if (settings.lowAlert === false || !Notification.isSupported()) return;
  for (const level of [10, 20]) {
    if (r.percent <= level && !alerted[level]) {
      alerted[10] = alerted[10] || r.percent <= 10;
      alerted[20] = true;
      new Notification({
        title: `Mouse battery at ${r.percent}%`,
        body: level === 10 ? "Plug in your mouse soon." : "Your mouse battery is getting low.",
        icon: path.join(__dirname, "icon.png")
      }).show();
      break;
    }
  }
}

const isPng = u => typeof u === "string" && u.startsWith("data:image/png;base64,");
ipcMain.on("tray:icon", (_e, imgs) => {
  if (!tray) return;
  if (!imgs || !isPng(imgs.x1) || !isPng(imgs.x2)) {
    tray.setImage(nativeImage.createFromPath(path.join(__dirname, "tray.png")));
    return;
  }
  const img = nativeImage.createEmpty();
  img.addRepresentation({ scaleFactor: 1, dataURL: imgs.x1 });
  img.addRepresentation({ scaleFactor: 2, dataURL: imgs.x2 });
  tray.setImage(img);
});
ipcMain.handle("battery:get", () => battery);
ipcMain.handle("battery:refresh", () => refreshBattery());
ipcMain.handle("battery:alert", (_e, on) => { settings.lowAlert = !!on; saveSettings(); broadcast(); return settings.lowAlert; });

/* ---------- Minecraft server player count (Java "server list ping") ---------- */
function mcVarInt(n) {
  n = n >>> 0;
  const out = [];
  do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b); } while (n);
  return Buffer.from(out);
}
function mcReadVarInt(buf, off) {
  let n = 0, shift = 0, b;
  do {
    if (off >= buf.length) return null;
    b = buf[off++];
    n |= (b & 0x7f) << shift;
    shift += 7;
  } while ((b & 0x80) && shift < 35);
  return [n, off];
}
function mcPing(host, port, handshakeHost) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host, port });
    sock.setTimeout(6000);
    let buf = Buffer.alloc(0), done = false;
    const t0 = Date.now();
    const finish = (err, val) => { if (done) return; done = true; sock.destroy(); err ? reject(err) : resolve(val); };
    sock.on("connect", () => {
      const h = Buffer.from(handshakeHost, "utf8");
      const p = Buffer.alloc(2); p.writeUInt16BE(port);
      const hs = Buffer.concat([mcVarInt(0), mcVarInt(767), mcVarInt(h.length), h, p, mcVarInt(1)]);
      sock.write(Buffer.concat([mcVarInt(hs.length), hs, Buffer.from([0x01, 0x00])]));
    });
    sock.on("data", d => {
      buf = Buffer.concat([buf, d]);
      const a = mcReadVarInt(buf, 0); if (!a) return;
      if (buf.length < a[1] + a[0]) return;
      const b = mcReadVarInt(buf, a[1]); if (!b) return;
      const c = mcReadVarInt(buf, b[1]); if (!c) return;
      try { finish(null, { json: JSON.parse(buf.slice(c[1], c[1] + c[0]).toString("utf8")), ping: Date.now() - t0 }); }
      catch (e) { finish(e); }
    });
    sock.on("timeout", () => finish(new Error("timeout")));
    sock.on("error", e => finish(e));
    sock.on("close", () => finish(new Error("closed")));
  });
}
const mcText = d => typeof d === "string" ? d : d && typeof d === "object" ? (d.text || "") + (Array.isArray(d.extra) ? d.extra.map(mcText).join("") : "") : "";
// Title + channel for a YouTube video (YouTube's public oEmbed endpoint)
ipcMain.handle("yt:info", async (_e, id) => {
  if (!/^[\w-]{11}$/.test(String(id || ""))) return null;
  try {
    const r = await fetch("https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent("https://www.youtube.com/watch?v=" + id));
    if (!r.ok) return null;
    const j = await r.json();
    return { title: j.title || "", author: j.author_name || "" };
  } catch { return null; }
});
/* ---------- Weather chip: Open-Meteo (free, no account), for a city you pick ---------- */
let wxCache = null;
const wxFetch = async url => { const { net: enet } = require("electron"); const r = await enet.fetch(url); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); };
ipcMain.handle("wx:find", async (_e, q) => {
  q = String(q || "").trim().slice(0, 80); if (q.length < 2) return [];
  try {
    const j = await wxFetch("https://geocoding-api.open-meteo.com/v1/search?count=6&language=en&format=json&name=" + encodeURIComponent(q));
    return (j.results || []).map(r => ({ name: r.name, region: [r.admin1, r.country_code].filter(Boolean).join(", "), lat: r.latitude, lon: r.longitude }));
  } catch { return null; }
});
ipcMain.handle("wx:cfg", (_e, c) => {
  if (c && typeof c === "object") {
    if ("on" in c) settings.wxOn = !!c.on;
    if (c.unit === "F" || c.unit === "C") settings.wxUnit = c.unit;
    if ("loc" in c) settings.wxLoc = c.loc && isFinite(c.loc.lat) && isFinite(c.loc.lon) ? { name: String(c.loc.name || "").slice(0, 80), region: String(c.loc.region || "").slice(0, 80), lat: +c.loc.lat, lon: +c.loc.lon } : null;
    wxCache = null; saveSettings();
  }
  return { on: settings.wxOn !== false, unit: settings.wxUnit === "C" ? "C" : "F", loc: settings.wxLoc || null };
});
ipcMain.handle("wx:get", async (_e, force) => {
  const loc = settings.wxLoc, unit = settings.wxUnit === "C" ? "C" : "F";
  if (!loc) return { none: true };
  if (process.env.SOTHIS_WX_SAMPLE) return JSON.parse(fs.readFileSync(process.env.SOTHIS_WX_SAMPLE, "utf8"));   // test runs only
  const key = loc.lat + "," + loc.lon + unit;
  if (!force && wxCache && wxCache.key === key && Date.now() - wxCache.at < 10 * 60 * 1000) return wxCache.data;
  try {
    const u = "https://api.open-meteo.com/v1/forecast?latitude=" + loc.lat + "&longitude=" + loc.lon +
      "&current=temperature_2m,apparent_temperature,weather_code,is_day,relative_humidity_2m,wind_speed_10m" +
      "&hourly=temperature_2m,weather_code,precipitation_probability,is_day&forecast_hours=12" +
      "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset&forecast_days=4" +
      "&timezone=auto" + (unit === "F" ? "&temperature_unit=fahrenheit&wind_speed_unit=mph" : "&wind_speed_unit=kmh");
    const j = await wxFetch(u), c = j.current || {}, h = j.hourly || {}, d = j.daily || {};
    const data = {
      loc, unit, at: Date.now(),
      now: { t: c.temperature_2m, feels: c.apparent_temperature, code: c.weather_code, day: c.is_day !== 0, hum: c.relative_humidity_2m, wind: c.wind_speed_10m },
      hours: (h.time || []).map((t, i) => ({ t: h.temperature_2m[i], code: h.weather_code[i], rain: h.precipitation_probability ? h.precipitation_probability[i] : null, day: h.is_day ? h.is_day[i] !== 0 : true, time: t })),
      days: (d.time || []).map((t, i) => ({ date: t, code: d.weather_code[i], hi: d.temperature_2m_max[i], lo: d.temperature_2m_min[i], rain: d.precipitation_probability_max ? d.precipitation_probability_max[i] : null }))
    };
    wxCache = { key, at: Date.now(), data };
    return data;
  } catch (e) { return wxCache && wxCache.key === key ? Object.assign({ stale: true }, wxCache.data) : { err: String(e.message || e) }; }
});
ipcMain.handle("mc:get", async (_e, { address }) => {
  const raw = String(address || "").trim().replace(/^[a-z]+:\/\//i, "").replace(/\/.*$/, "");
  const m = raw.match(/^([a-z0-9.-]+)(?::(\d{1,5}))?$/i);
  if (!m) return { error: "badaddress" };
  const host = m[1], port = m[2] ? +m[2] : null;
  // Direct ping first (live), using the server's SRV record when there's no port.
  try {
    let target = { host, port: port || 25565 };
    if (!port) {
      try { const srv = await dnsp.resolveSrv(`_minecraft._tcp.${host}`); if (srv && srv[0]) target = { host: srv[0].name, port: srv[0].port }; } catch {}
    }
    const r = await mcPing(target.host, target.port, host);
    const pl = r.json.players || {};
    return {
      online: true, players: pl.online ?? 0, max: pl.max ?? 0,
      names: Array.isArray(pl.sample) ? pl.sample.map(x => x && x.name).filter(Boolean) : [],
      version: (r.json.version && r.json.version.name) || "", motd: mcText(r.json.description).replace(/§./g, "").trim(), ping: r.ping
    };
  } catch {}
  // Fallback: public status service (refreshes every few minutes).
  const r = await getJson(`https://api.mcsrvstat.us/3/${encodeURIComponent(raw)}`);
  if (r.status === 200 && r.json) {
    const j = r.json;
    if (!j.online) return { online: false };
    return {
      online: true, players: (j.players && j.players.online) || 0, max: (j.players && j.players.max) || 0,
      names: j.players && Array.isArray(j.players.list) ? j.players.list.map(x => x && (x.name || x)).filter(x => typeof x === "string") : [],
      version: j.version || "", motd: j.motd && Array.isArray(j.motd.clean) ? j.motd.clean.join(" ").trim() : "", ping: null
    };
  }
  return { online: false, unreachable: true };
});

/* ---------- CS2 stats (Steam profile -> Leetify public API) ---------- */
async function getJson(url, headers) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000), headers: Object.assign({ Accept: "application/json" }, headers || {}) });
    let json = null;
    try { json = await r.json(); } catch {}
    return { status: r.status, json };
  } catch {
    return { status: 0, json: null };
  }
}
// Friends' Steam status (online / in which game), from their public Steam profile; cached for a minute
const frStatCache = {};
// Game server status: Ubisoft's own status feed (Siege and other Ubisoft games) and steamstat.us (Steam and CS2); cached 5 minutes
let gsCache = null, gsAt = 0;
ipcMain.handle("games:status", async () => {
  if (gsCache && Date.now() - gsAt < 5 * 60000) return gsCache;
  const out = { ubi: {}, steam: null, cs: null };
  const lvl = s => /online|good|ok/i.test(s) ? "ok" : /maint/i.test(s) ? "maint" : /degrad|minor|partial|slow/i.test(s) ? "warn" : /interrupt|major|down|offline|outage/i.test(s) ? "down" : "";
  await Promise.all([
    (async () => { try {
      const j = await (await fetch("https://game-status-api.ubisoft.com/v1/instances", { signal: AbortSignal.timeout(10000) })).json();
      for (const a of Array.isArray(j) ? j : []) {
        if (String(a.Platform || "").toUpperCase() !== "PC") continue;
        const name = String(a.Name || "").replace(/\s*-\s*PC$/i, "").trim(), l = lvl(a.Status || "");
        if (name && l) out.ubi[name] = { s: l, t: String(a.Status || "") + (a.Maintenance ? " · maintenance" : "") + (Array.isArray(a.ImpactedFeatures) && a.ImpactedFeatures.length ? " · " + a.ImpactedFeatures.slice(0, 3).join(", ") : "") };
      }
    } catch {} })(),
    (async () => { try {
      const j = await (await fetch("https://crowbar.steamstat.us/gravity.json", { signal: AbortSignal.timeout(10000) })).json();
      const sv = Array.isArray(j && j.services) ? j.services : [];
      const get = re => sv.filter(x => Array.isArray(x) && re.test(String(x[0]))).map(x => ({ s: lvl(String(x[1])), t: String(x[2] || x[1]) }));
      const worst = arr => arr.reduce((w, x) => (["down", "maint", "warn", "ok"].indexOf(x.s) < ["down", "maint", "warn", "ok"].indexOf(w.s) ? x : w), arr[0]);
      const st = get(/^(cms|steam)$/i); if (st.length) out.steam = worst(st);
      const cs = get(/^csgo/i); if (cs.length) out.cs = worst(cs);
    } catch {} })()
  ]);
  gsCache = out; gsAt = Date.now();
  return out;
});
// Game news (patch notes and announcements) from Steam's public news feed; cached for 30 minutes
const newsCache = {};
ipcMain.handle("games:news", async (_e, appid) => {
  const id = String(appid || "").replace(/\D/g, ""); if (!id) return null;
  const c = newsCache[id]; if (c && Date.now() - c.at < 30 * 60000) return c.v;
  try {
    const r = await fetch(`https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${id}&count=20&maxlength=260&format=json`, { signal: AbortSignal.timeout(12000) });
    const j = await r.json();
    const clean = t => String(t || "").replace(/\{STEAM_CLAN_IMAGE\}[^\s]*/g, "").replace(/\[\/?[a-z0-9*=_ "'.:/#-]*\]/gi, " ").replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
    // English only: skip posts whose text is mostly non-Latin, or that use other languages' accented letters / common words a lot
    const english = n => {
      const t = clean(n.title) + " " + clean(n.contents);
      const letters = (t.match(/\p{L}/gu) || []).length, ascii = (t.match(/[A-Za-z]/g) || []).length;
      if (!letters || ascii / letters < 0.97) return false;
      const words = t.toLowerCase().match(/[a-z]+/g) || [], en = words.filter(w => /^(the|and|to|of|in|for|is|on|with|you|this|new|are|we|our|your|be|will|now|from|at|it|update|patch)$/.test(w)).length;
      const other = words.filter(w => /^(der|die|und|das|ist|nicht|les|des|est|une|pour|avec|que|los|las|por|para|con|una|het|een|och|det|och|jest|nie|dla)$/.test(w)).length;
      return en >= other;
    };
    const items = ((j.appnews && j.appnews.newsitems) || []).filter(n => /^https:\/\//.test(n.url || "") && english(n)).slice(0, 4)
      .map(n => ({ title: clean(n.title).slice(0, 140), url: n.url, at: (n.date || 0) * 1000, feed: clean(n.feedlabel).slice(0, 40), text: clean(n.contents).slice(0, 200) }));
    newsCache[id] = { at: Date.now(), v: items };
    return items;
  } catch { return c ? c.v : null; }
});
ipcMain.handle("fr:status", async (_e, list) => {
  const out = {};
  await Promise.all((Array.isArray(list) ? list : []).slice(0, 30).map(async ({ id, steam }) => {
    const input = String(steam || "").trim(); if (!input || !id) return;
    const c = frStatCache[input]; if (c && Date.now() - c.at < 60000) { out[id] = c.v; return; }
    const m64 = input.match(/(7656\d{13})/), v = input.match(/steamcommunity\.com\/id\/([^\/?#\s]+)/i);
    const vanity = v ? v[1] : (/^[\w.-]{2,64}$/.test(input) ? input : null);
    if (!m64 && !vanity) return;
    const url = m64 ? `https://steamcommunity.com/profiles/${m64[1]}/?xml=1` : `https://steamcommunity.com/id/${encodeURIComponent(vanity)}/?xml=1`;
    try {
      const t = await (await fetch(url, { signal: AbortSignal.timeout(10000) })).text();
      const pick = tag => { const m = t.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))</${tag}>`)); return m ? String(m[1] != null ? m[1] : m[2] || "").trim() : ""; };
      const state = pick("onlineState");   // online / offline / in-game
      const gameName = (t.match(/<inGameInfo>[\s\S]*?<gameName><!\[CDATA\[([\s\S]*?)\]\]><\/gameName>/) || [])[1] || "";
      const msg = pick("stateMessage").replace(/<br\s*\/?>/gi, " · ").replace(/<[^>]+>/g, "").trim();
      const val = { state: state || "unknown", game: gameName.replace(/[®™©]/g, "").trim() || (state === "in-game" ? msg.replace(/^In-Game\s*·\s*/i, "") : ""), msg };
      frStatCache[input] = { at: Date.now(), v: val }; out[id] = val;
    } catch {}
  }));
  return out;
});
ipcMain.handle("cs:get", async (_e, { steam }) => {
  const input = String(steam || "").trim();
  let id = null, xmlUrl = null;
  const m64 = input.match(/(7656\d{13})/);
  if (m64) {
    id = m64[1];
    xmlUrl = `https://steamcommunity.com/profiles/${id}/?xml=1`;
  } else {
    const v = input.match(/steamcommunity\.com\/id\/([^\/?#\s]+)/i);
    const vanity = v ? v[1] : (/^[\w.-]{2,64}$/.test(input) ? input : null);
    if (!vanity) return { error: "badinput" };
    xmlUrl = `https://steamcommunity.com/id/${encodeURIComponent(vanity)}/?xml=1`;
  }
  let name = "", avatar = "";
  try {
    const r = await fetch(xmlUrl, { signal: AbortSignal.timeout(12000) });
    const t = await r.text();
    const pick = tag => {
      const m = t.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))</${tag}>`));
      return m ? String(m[1] != null ? m[1] : m[2] || "").trim() : "";
    };
    if (!id) id = pick("steamID64") || null;
    name = pick("steamID");
    avatar = pick("avatarFull");
  } catch {}
  if (!id) return { error: "notfound" };
  const leetify = await getJson(`https://api-public.cs-prod.leetify.com/v3/profile?steam64_id=${id}`);
  return { steam64: id, name, avatar, leetify };
});

/* ---------- Rainbow Six Siege stats (stats.cc public API) ---------- */
const R6_API = "https://r6.stats.cc/v2";
let r6Cfg = null, r6CfgAt = 0;
async function r6Json(url) {
  const opts = { headers: { Accept: "application/json" } };
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 20000));
  const go = async useSession => {
    const ses = useSession ? session.fromPartition("persist:statscc") : null;
    const r = await Promise.race([ses && ses.fetch ? ses.fetch(url, opts) : fetch(url, opts), timeout]);
    let json = null;
    try { json = await r.json(); } catch {}
    return { status: r.status, json };
  };
  try { return await go(true); } catch {}
  try { return await go(false); } catch { return { status: 0, json: null }; }
}
async function r6Config() {
  if (r6Cfg && Date.now() - r6CfgAt < 6 * 3600 * 1000) return r6Cfg;
  const r = await r6Json(R6_API + "/config");
  if (r.status !== 200 || !r.json) return r6Cfg;
  const c = r.json, pick = (o, f) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, f(v || {})]));
  r6Cfg = {
    current: (c.constants && c.constants.slugs && c.constants.slugs.current_season) || "",
    seasons: pick(c.seasons, v => ({ name: v.display, year: v.year, n: v.season, color: v.primary_color })),
    ranks: pick(c.ranks, v => ({ name: /^(no rank|not ranked)$/i.test(String(v.display || "")) ? "Unranked" : v.display, tier: v.tier })),
    tiers: pick(c.rank_tiers, v => ({ name: v.display, color: v.color })),
    ops: pick(c.operators, v => ({ name: v.display, side: v.side })),
    maps: pick(c.maps, v => v.display)
  };
  r6CfgAt = Date.now();
  return r6Cfg;
}
ipcMain.handle("r6:get", async (_e, { id, playlist }) => {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ""))) return { error: "badinput" };
  const pl = ["ranked", "quick-match", "unranked"].includes(playlist) ? playlist : "ranked";
  const base = `${R6_API}/profiles/${id}`;
  const [profile, matches, operators, config] = await Promise.all([
    r6Json(base), r6Json(`${base}/matches?playlist=${pl}`), r6Json(`${base}/operators?playlist=${pl}`), r6Config()
  ]);
  return { profile, matches, operators, config };
});
ipcMain.handle("r6:search", async (_e, { name, platform }) => {
  const pf = ["pc", "xbox", "playstation"].includes(platform) ? platform : "pc";
  const r = await r6Json(`${R6_API}/profiles/search?username=${encodeURIComponent(String(name || "").trim())}&platform=${pf}`);
  const list = Array.isArray(r.json) ? r.json.map(x => x && x.profile).filter(Boolean).slice(0, 8).map(p => ({
    id: p.id, name: p.username, platform: p.platform, level: p.level,
    rank: p.ranked_season_record ? p.ranked_season_record.rank : "", rp: p.ranked_season_record ? p.ranked_season_record.rank_points : null
  })) : [];
  return { status: r.status, results: list };
});

/* ---------- Rainbow Six live scoreboard: read the names off the in-game Tab screen ---------- */
const R6TAB = { w: 720, h: 520 };
const R6_KEYS = ["F6", "F7", "F8", "F9", "F10"];
let r6TabWin = null, r6TabReady = false, r6TabPending = null, r6TabOpen = false, r6TabBusy = false, r6TabKey = "";
const r6LiveOn = () => false;   // live scoreboard key removed (F9 is free again)
const r6Key = () => R6_KEYS.includes(settings.r6Key) ? settings.r6Key : (medalKey() === "F9" ? "F8" : "F9");
function ensureR6TabWin() {
  if (r6TabWin && !r6TabWin.isDestroyed()) return r6TabWin;
  r6TabReady = false;
  r6TabWin = new BrowserWindow({
    width: R6TAB.w, height: R6TAB.h, show: false, frame: false, transparent: true, resizable: false,
    movable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true,
    focusable: false, hasShadow: false, alwaysOnTop: true, backgroundColor: "#00000000",
    webPreferences: { preload: path.join(__dirname, "r6tab-preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  r6TabWin.setAlwaysOnTop(true, "screen-saver");
  r6TabWin.setVisibleOnAllWorkspaces(true);
  r6TabWin.setIgnoreMouseEvents(true);   // clicks go straight through to the game
  r6TabWin.loadFile(path.join(__dirname, "r6tab.html"));
  r6TabWin.webContents.on("did-finish-load", () => {
    r6TabReady = true;
    if (r6TabPending) { const p = r6TabPending; r6TabPending = null; r6TabShow(p.display, p.data, p.ms); }
  });
  r6TabWin.on("closed", () => { r6TabWin = null; r6TabReady = false; r6TabOpen = false; });
  return r6TabWin;
}
function r6TabShow(display, data, ms) {
  const w = ensureR6TabWin();
  if (!r6TabReady) { r6TabPending = { display, data, ms }; return; }
  const a = display.bounds;
  w.setBounds({ x: a.x + Math.round((a.width - R6TAB.w) / 2), y: a.y + Math.round(a.height * 0.06), width: R6TAB.w, height: R6TAB.h });
  data.key = r6Key();
  w.webContents.executeJavaScript(`window.showBoard(${JSON.stringify(data)}, ${ms || 0})`).catch(() => {});
  w.showInactive(); w.setAlwaysOnTop(true, "screen-saver");
  r6TabOpen = true;
}
function r6TabHide() {
  r6TabOpen = false;
  if (r6TabWin && !r6TabWin.isDestroyed() && r6TabReady) r6TabWin.webContents.executeJavaScript("window.hideBoard()").catch(() => r6TabWin.hide());
}
ipcMain.on("r6tab:hidden", () => { r6TabOpen = false; if (r6TabWin && !r6TabWin.isDestroyed()) r6TabWin.hide(); });

async function r6GrabScreen(display) {
  const sf = display.scaleFactor || 1;
  const size = { width: Math.round(display.size.width * sf), height: Math.round(display.size.height * sf) };
  const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: size });
  const src = sources.find(s => String(s.display_id) === String(display.id)) || sources[0];
  if (!src || src.thumbnail.isEmpty()) return null;
  const file = path.join(app.getPath("temp"), "sothis-r6tab-" + Date.now() + ".png");
  fs.writeFileSync(file, src.thumbnail.toPNG());
  return file;
}
function r6Ocr(file, scale, fg) {
  return new Promise(resolve => {
    execFile("powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "r6-ocr.ps1"), "-Path", file, "-Scale", String(scale || 2), ...(fg ? ["-Fg"] : [])],
      { windowsHide: true, timeout: 30000, maxBuffer: 16 << 20 },
      (err, stdout, stderr) => {
        const out = String(stdout || "");
        const b64 = out.split(/\r?\n/).map(l => l.trim()).filter(l => l.startsWith("SOTHISB64:")).pop();
        const line = b64 ? Buffer.from(b64.slice(10), "base64").toString("utf8") : (out.trim().split(/\r?\n/).filter(Boolean).pop() || "");
        try { resolve(JSON.parse(line)); } catch {
          const why = err ? String(err.message || err).split("\n")[0] : "no-output";
          resolve({ error: why + " | out " + out.length + "b: " + out.slice(0, 160).replace(/\s+/g, " ") + " | err: " + String(stderr || "").slice(0, 240).replace(/\s+/g, " ") });
        }
      });
  });
}
// Scoreboard rows: a Ubisoft-style name followed by at least two numbers (score, kills, deaths…).
const R6_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{1,15}$/;
const R6_HEAD = /^(score|kills?|assists?|deaths?|ping|k|a|d|kd|team|you|rank|level|lvl|ranked|round|defenders?|attackers?)$/i;
function r6ParseNames(ocr) {
  const words = [];
  (ocr.lines || []).forEach(l => (l.words || []).forEach(w => { if (w && w.t) words.push(Object.assign({}, w, { cy: w.y + w.h / 2 })); }));
  words.sort((a, b) => a.cy - b.cy);
  // group words that sit on the same row
  const rows = [];
  for (const w of words) {
    const r = rows.find(r => Math.abs(r.cy - w.cy) <= Math.max(6, r.h * 0.6));
    if (r) { r.words.push(w); r.cy = (r.cy * (r.words.length - 1) + w.cy) / r.words.length; r.h = Math.max(r.h, w.h); }
    else rows.push({ cy: w.cy, h: w.h, words: [w] });
  }
  const found = [];
  for (const r of rows) {
    r.words.sort((a, b) => a.x - b.x);
    if (r.words.filter(w => /^\d{1,5}$/.test(w.t)).length < 2) continue;
    const cand = r.words.find(w => !/^\d+$/.test(w.t) && R6_NAME.test(w.t) && !R6_HEAD.test(w.t) && /[A-Za-z]/.test(w.t));
    if (cand) found.push({ read: cand.t, x: cand.x, y: r.cy });
  }
  if (!found.length) return [];
  // names line up in one column; drop stray matches far from it
  const xs = found.map(f => f.x).sort((a, b) => a - b), mx = xs[Math.floor(xs.length / 2)];
  const tol = Math.max(40, (ocr.w || 1920) * 0.06);
  const seen = new Set();
  const names = found.filter(f => Math.abs(f.x - mx) <= tol).filter(f => { const k = f.read.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 10);
  // split into two teams at the biggest gap
  if (names.length < 4) return [names];
  let at = -1, gap = 0;
  for (let i = 1; i < names.length; i++) { const g = names[i].y - names[i - 1].y; if (g > gap) { gap = g; at = i; } }
  const gaps = names.slice(1).map((n, i) => n.y - names[i].y).sort((a, b) => a - b), med = gaps[Math.floor(gaps.length / 2)];
  return gap > med * 1.6 ? [names.slice(0, at), names.slice(at)] : [names];
}
const lev = (a, b) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};
async function r6LookupName(read, platform, cfg) {
  const r = await r6Json(`${R6_API}/profiles/search?username=${encodeURIComponent(read)}&platform=${platform}`);
  const list = Array.isArray(r.json) ? r.json.map(x => x && x.profile).filter(Boolean) : [];
  const low = read.toLowerCase();
  const p = list.find(x => String(x.username).toLowerCase() === low) || list.find(x => lev(String(x.username).toLowerCase(), low) <= 2) || (list.length === 1 ? list[0] : null);
  if (!p) return { read, found: false };
  const rec = p.ranked_season_record || {}, md = p.ranked_season_mode_record || {};
  const rk = rec.rank && cfg && cfg.ranks[rec.rank], tier = rk && cfg.tiers[rk.tier];
  return {
    read, found: true, name: p.username, id: p.id,
    rankName: rk ? rk.name : rec.rank ? rec.rank.replace(/^v\d+-/, "").replace(/-/g, " ") : "Unranked",
    rankColor: tier ? tier.color : "", rankImg: rec.rank ? `https://static.stats.cc/siege/ranks/${rec.rank}-small.webp` : "",
    rp: rec.rank && !/unranked/.test(rec.rank) ? rec.rank_points : null,
    kd: typeof md.kd === "number" && md.matches ? md.kd : null, wr: typeof md.wr === "number" && md.matches ? md.wr : null, matches: md.matches ?? null
  };
}
async function r6TabRun() {
  if (r6TabOpen) { r6TabHide(); return; }
  if (r6TabBusy) return;
  r6TabBusy = true;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  let file = null;
  try {
    file = await r6GrabScreen(display);   // take the picture first, before anything of ours is on screen
    r6TabShow(display, { state: "reading" });
    if (!file) throw new Error("Couldn't take a screenshot of your screen.");
    const [ocr, cfg] = await Promise.all([r6Ocr(file), r6Config()]);
    try { fs.writeFileSync(path.join(DATA_DIR, "r6-live-last.json"), JSON.stringify({ at: new Date().toISOString(), ocr })); } catch {}
    if (ocr.error) throw new Error("Windows couldn't read the screen (" + ocr.error + ").");
    // the map name is usually on screen too; remember it for your Discord status
    try {
      const allText = (ocr.lines || []).map(l => l.t).join(" ").toLowerCase();
      const maps = cfg && cfg.maps ? Object.values(cfg.maps).filter(x => typeof x === "string" && x.length > 3 && !/unknown/i.test(x)) : [];
      const hit = maps.sort((a, b) => b.length - a.length).find(n => allText.includes(n.toLowerCase()));
      if (hit) { r6MapNow = { name: hit, at: Date.now() }; dcPresence(); }
    } catch {}
    const teams = r6ParseNames(ocr);
    if (!teams.length || !teams[0].length) throw new Error(`No player names found. Hold Tab so the scoreboard is open, then press ${r6Key()}. Siege needs to be in Borderless or Windowed mode.`);
    const plat = ["pc", "xbox", "playstation"].includes(settings.r6Plat) ? settings.r6Plat : "pc";
    const looked = await Promise.all(teams.map(t => Promise.all(t.map(n => r6LookupName(n.read, plat, cfg).catch(() => ({ read: n.read, found: false }))))));
    const season = cfg && cfg.current && cfg.seasons[cfg.current] ? cfg.seasons[cfg.current].name : "";
    r6TabShow(display, { state: "done", teams: looked, me: settings.r6Me || "", season }, 30000);
  } catch (e) {
    r6TabShow(display, { state: "error", message: String((e && e.message) || e) }, 9000);
  } finally {
    r6TabBusy = false;
    if (file) try { fs.unlinkSync(file); } catch {}
  }
}
function r6RegisterKey() {
  if (r6TabKey) { try { globalShortcut.unregister(r6TabKey); } catch {} r6TabKey = ""; }
  if (!r6LiveOn()) return true;
  let ok = false;
  try { ok = globalShortcut.register(r6Key(), () => { r6TabRun(); }); } catch {}
  if (ok) r6TabKey = r6Key();
  return ok;
}
ipcMain.handle("r6live:get", () => ({ on: r6LiveOn(), key: r6Key(), registered: !!r6TabKey }));
ipcMain.handle("r6live:set", (_e, { on, key }) => {
  if (typeof on === "boolean") settings.r6Live = on;
  if (R6_KEYS.includes(key)) settings.r6Key = key;
  saveSettings();
  const ok = r6RegisterKey();
  return { on: r6LiveOn(), key: r6Key(), registered: ok && !!r6TabKey };
});
ipcMain.handle("r6live:me", (_e, { name, platform }) => {
  if (name) settings.r6Me = String(name).slice(0, 32);
  if (["pc", "xbox", "playstation"].includes(platform)) settings.r6Plat = platform;
  saveSettings();
  return true;
});
ipcMain.handle("r6live:test", () => { setTimeout(r6TabRun, 3000); return true; });
app.on("will-quit", () => { try { globalShortcut.unregisterAll(); } catch {} });

/* ---------- stats.cc (Rainbow Six Siege) shown inside the Stats tab ---------- */
const isStatsCC = url => { try { const h = new URL(url).hostname.toLowerCase(); return h === "stats.cc" || h.endsWith(".stats.cc"); } catch { return false; } };
const isDiscord = url => { try { const h = new URL(url).hostname.toLowerCase(); return /(^|\.)(discord\.com|discordapp\.com|discord\.gg)$/.test(h); } catch { return false; } };
// Songspot (the song guessing game in the Music tab) and its sister games on allspot.net
const isSongspot = url => { try { const h = new URL(url).hostname.toLowerCase(); return /(^|\.)(songspot\.net|allspot\.net)$/.test(h); } catch { return false; } };
const inAppSite = url => isStatsCC(url) || isDiscord(url) || isSongspot(url);
/* ---------- Temporary Discord login log (addresses + error codes only, no content) ---------- */
const DLOG = path.join(app.getPath("downloads"), "Sothis", "sothis-discord-log.txt");
const DLOG_ON = false;   // temporary Discord login log, now switched off
function dlog(line) {
  if (!DLOG_ON) return;
  try { fs.appendFileSync(DLOG, new Date().toISOString().slice(11, 19) + "  " + line + "\n"); } catch {}
}
const cleanUrl = u => { try { const x = new URL(u); return x.origin + x.pathname; } catch { return String(u).slice(0, 120); } };
app.whenReady().then(() => {
  dlog("---- Sothis started " + new Date().toString());
  const ds = session.fromPartition("persist:discord");
  ds.webRequest.onCompleted({ urls: ["*://*/*"] }, d => {
    if (d.statusCode >= 400 || /\/api\/v\d+\/auth/.test(d.url)) dlog(`HTTP ${d.statusCode} ${d.method} ${cleanUrl(d.url)}`);
  });
  ds.webRequest.onErrorOccurred({ urls: ["*://*/*"] }, d => dlog(`FAILED ${d.error} ${d.method} ${cleanUrl(d.url)}`));
});
app.on("web-contents-created", (_e, c) => {
  setTimeout(() => {
    if (c.isDestroyed() || c.getType() !== "webview") return;
    const isD = u => /discord/i.test(String(u || ""));
    let announced = false;
    // Discord tab: present a consistent Google Chrome identity in every frame (incl. the captcha),
    // and log Discord's reason when a login request is refused.
    if (c.session === session.fromPartition("persist:discord")) {
      try {
        const major = process.versions.chrome.split(".")[0], full = process.versions.chrome;
        const ua = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
        c.debugger.attach("1.3");
        c.debugger.sendCommand("Emulation.setUserAgentOverride", {
          userAgent: ua, platform: "Win32", acceptLanguage: "en-US,en",
          userAgentMetadata: {
            brands: [{ brand: "Google Chrome", version: major }, { brand: "Chromium", version: major }, { brand: "Not?A_Brand", version: "99" }],
            fullVersionList: [{ brand: "Google Chrome", version: full }, { brand: "Chromium", version: full }, { brand: "Not?A_Brand", version: "99.0.0.0" }],
            platform: "Windows", platformVersion: "15.0.0", architecture: "x86", model: "", mobile: false, bitness: "64", wow64: false
          }
        }).catch(e => dlog("UA override failed " + e.message));
        c.debugger.sendCommand("Network.enable").catch(() => {});
        const watch = new Map();
        c.debugger.on("message", (_ev, method, p) => {
          if (method === "Network.responseReceived" && p.response.status >= 400 && /\/api\/v\d+\/(auth|users\/@me\/remote-auth)/.test(p.response.url)) watch.set(p.requestId, p.response.status);
          if (method === "Network.loadingFinished" && watch.has(p.requestId)) {
            const code = watch.get(p.requestId); watch.delete(p.requestId);
            c.debugger.sendCommand("Network.getResponseBody", { requestId: p.requestId })
              .then(r => dlog(`REASON ${code}: ` + String(r.body || "").replace(/"(token|encrypted_token|ticket|captcha_rqtoken|captcha_session_id)"\s*:\s*"[^"]*"/g, '"$1":"[hidden]"').slice(0, 400)))
              .catch(() => {});
          }
        });
        dlog("Chrome identity set for Discord");
      } catch (e) { dlog("debugger attach failed " + e.message); }
    }
    const hello = u => { if (!announced && isD(u)) { announced = true; dlog("Discord view opened"); } };
    c.on("did-start-navigation", (_e2, url, inPage, main) => { if (main && isD(url)) { hello(url); dlog("GOING TO " + cleanUrl(url)); } });
    c.on("did-navigate", (_e2, url) => { if (isD(url)) { hello(url); dlog("NAV " + cleanUrl(url)); } });
    c.on("did-navigate-in-page", (_e2, url) => { if (isD(url)) dlog("PAGE " + cleanUrl(url)); });
    c.on("did-fail-load", (_e2, code, desc, url) => { if (isD(url)) dlog(`LOAD FAILED ${code} ${desc} ${cleanUrl(url)}`); });
    c.on("console-message", (_e2, level, msg) => { if (announced && level >= 2) dlog("CONSOLE " + String(msg).replace(/[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}/g, "[token]").slice(0, 300)); });
    c.on("render-process-gone", (_e2, d) => { if (announced) dlog("CRASHED " + d.reason); });
  }, 0);
});

app.on("web-contents-created", (_e, contents) => {
  contents.on("will-attach-webview", (ev, prefs, params) => {
    delete prefs.preload;
    prefs.nodeIntegration = false;
    prefs.contextIsolation = true;
    prefs.sandbox = true;
    prefs.backgroundThrottling = false;   // keep audio smooth while the tab is hidden
    const isBrowser = params.partition === "persist:browser" || params.partition === "persist:ytm" || params.partition === "persist:claude";
    // Retro games: their own saved storage (persist:emu), only ever the bundled player
    if (params.partition === "persist:emu") { if (!/^sothisemu:\/\/app\//i.test(params.src || "")) ev.preventDefault(); return; }
    if (params.src && !(isBrowser ? /^https?:\/\//i.test(params.src) : inAppSite(params.src))) ev.preventDefault();
  });
  if (contents.getType() === "webview") {
    // Browser tab shortcuts (Ctrl+T/W/L/R, F5, Alt+arrows) still work while a page has focus
    contents.on("before-input-event", (ev, i) => {
      if (i.type !== "keyDown" || contents.session !== session.fromPartition("persist:browser")) return;
      const k = (i.key || "").toLowerCase(), c = i.control || i.meta;
      const combo = c && !i.alt && ["t", "w", "l", "r", "tab"].includes(k) ? (i.shift && k === "tab" ? "ctrl+shift+tab" : i.shift && k === "t" ? "ctrl+shift+t" : "ctrl+" + k)
        : k === "f5" ? "f5" : i.alt && !c && (k === "arrowleft" || k === "arrowright") ? "alt+" + k : null;
      if (!combo) return;
      ev.preventDefault();
      if (win && !win.isDestroyed()) win.webContents.send("web:key", combo);
    });
    contents.setWindowOpenHandler(({ url, disposition }) => {
      // Built-in browser: new tabs open in the same view; real pop-ups (sign-in windows) get a small window.
      // Browser tab: links that want a new tab open as a Sothis browser tab
      // Browser tab pop-up blocker: real pop-up windows are stopped unless they're a sign-in window
      if (contents.session === session.fromPartition("persist:browser") && disposition === "new-window" && settings.popBlock !== false && /^https?:\/\//i.test(url)
        && !/(accounts\.google|login|signin|sign-in|oauth|auth|sso|appleid|discord\.com\/(api\/)?oauth|paypal|checkout|steamcommunity\.com\/openid)/i.test(url)) {
        if (win && !win.isDestroyed()) win.webContents.send("web:popup", { url, from: contents.id });
        return { action: "deny" };
      }
      if (contents.session === session.fromPartition("persist:browser") && disposition !== "new-window") {
        if (/^https?:\/\//i.test(url) && win && !win.isDestroyed()) win.webContents.send("web:open", { url, bg: disposition === "background-tab" });
        return { action: "deny" };
      }
      if (contents.session === session.fromPartition("persist:browser") || contents.session === session.fromPartition("persist:ytm") || contents.session === session.fromPartition("persist:claude")) {
        if (!/^https?:\/\//i.test(url)) return { action: "deny" };
        if (disposition === "new-window") return { action: "allow", overrideBrowserWindowOptions: { width: 520, height: 720, parent: win, autoHideMenuBar: true, alwaysOnTop: isPinned() } };
        contents.loadURL(url);
        return { action: "deny" };
      }
      if (inAppSite(url) && !/\/oauth2\//.test(url)) { contents.loadURL(url); return { action: "deny" }; }
      if (isDiscord(url)) return { action: "allow", overrideBrowserWindowOptions: { width: 520, height: 720, parent: win, autoHideMenuBar: true, alwaysOnTop: isPinned() } };
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
      return { action: "deny" };
    });
  }
});

/* ---------- Browser ad blocker ---------- */
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
let adNotifyT = new Map();
function adIsBlocked(host) {
  for (let h = host; h && h.includes("."); h = h.slice(h.indexOf(".") + 1)) if (adHosts.has(h)) return true;
  return false;
}
function adNotify(id, n) {
  if (adNotifyT.has(id)) return;
  adNotifyT.set(id, setTimeout(() => { adNotifyT.delete(id); if (win && !win.isDestroyed()) win.webContents.send("web:blocked", { id, n: adCounts.get(id) || n }); }, 400));
}
async function adListLoad() {
  const f = path.join(DATA_DIR, "adblock-hosts.txt");
  const use = txt => { const set = new Set(AD_BUILTIN); for (const l of String(txt).split(/\r?\n/)) { const h = l.trim().toLowerCase(); if (h && !h.startsWith("#") && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(h)) set.add(h); } if (set.size > AD_BUILTIN.length) adHosts = set; };
  try { const st = fs.statSync(f); use(fs.readFileSync(f, "utf8")); if (Date.now() - st.mtimeMs < 3 * 86400000) return; } catch {}
  try {   // Peter Lowe's ad and tracking server list (plain host names)
    const { net: enet } = require("electron");
    const r = await enet.fetch("https://pgl.yoyo.org/adservers/serverlist.php?hostformat=nohtml&showintro=0&mimetype=plaintext");
    if (r.ok) { const t = await r.text(); if (t.split("\n").length > 500) { fs.writeFileSync(f, t); use(t); } }
  } catch {}
}
ipcMain.handle("web:blockCfg", (_e, c) => {
  if (c && typeof c.ads === "boolean") settings.adBlock = c.ads;
  if (c && typeof c.pops === "boolean") settings.popBlock = c.pops;
  if (c) saveSettings();
  return { ads: settings.adBlock !== false, pops: settings.popBlock !== false };
});
ipcMain.handle("web:blockedCount", (_e, id) => adCounts.get(id) || 0);

/* ---------- Overwatch stats (public career profile via OverFast API) ---------- */
const OW_API = "https://overfast-api.tekrop.fr";
let owHeroes = null;
async function owFetch(p) {
  try {
    const r = await fetch(OW_API + p, { signal: AbortSignal.timeout(20000), headers: { Accept: "application/json", "User-Agent": app.userAgentFallback } });
    let json = null;
    try { json = await r.json(); } catch {}
    return { status: r.status, json };
  } catch {
    return { status: 0, json: null };
  }
}
ipcMain.handle("ow:get", async (_e, { tag, platform, mode }) => {
  const raw = String(tag || "").trim();
  let id = raw.replace("#", "-");
  if (!id) return { error: "notag" };
  const plat = platform === "console" ? "console" : "pc";
  const gm = mode === "quickplay" ? "quickplay" : "competitive";
  let summary = await owFetch(`/players/${encodeURIComponent(id)}/summary`);
  let isPublic = null;
  // BattleTags are case-sensitive here; if it isn't found, look the name up to get the exact spelling.
  if (summary.status === 404) {
    const name = raw.split("#")[0];
    const found = await owFetch(`/players?name=${encodeURIComponent(name)}&limit=20`);
    const hit = found.json && Array.isArray(found.json.results)
      ? found.json.results.find(r => String(r.player_id || "").toLowerCase() === id.toLowerCase())
      : null;
    if (hit) {
      id = hit.player_id;
      isPublic = hit.is_public;
      summary = await owFetch(`/players/${encodeURIComponent(id)}/summary`);
    }
  }
  const stats = summary.status === 200
    ? await owFetch(`/players/${encodeURIComponent(id)}/stats/summary?gamemode=${gm}&platform=${plat}`)
    : { status: summary.status, json: null };
  return { summary, stats, id, isPublic };
});
ipcMain.handle("ow:search", async (_e, { name }) => {
  const q = String(name || "").trim().split("#")[0];
  if (!q) return { status: 0, results: [] };
  const r = await owFetch(`/players?name=${encodeURIComponent(q)}&limit=12`);
  const results = r.json && Array.isArray(r.json.results)
    ? r.json.results.map(x => ({ id: x.player_id, name: x.name, avatar: x.avatar, title: typeof x.title === "string" ? x.title : "", isPublic: x.is_public }))
    : [];
  return { status: r.status, results };
});
// You tell Sothis which hero you're on: it remembers what that hero's picture (your skin) looks like
ipcMain.handle("ow:hero", () => ({ name: owHero ? owHero.name : "", canLearn: !!(hudLast && Date.now() - hudLast.at < 3 * 60000) }));
// Settings backup: everything except passwords, secrets and sign-in tokens (those never leave this PC)
const SECRET_KEY = /secret|token|pass(word)?|apikey|api_key/i;
ipcMain.handle("backup:export", async (_e, local) => {
  const copy = JSON.parse(JSON.stringify(settings));
  if (copy.discord) for (const k of ["clientSecret", "accessToken", "refreshToken", "expiresAt"]) delete copy.discord[k];
  if (copy.obs) delete copy.obs.pass;
  delete copy.sessLive;
  const loc = {};
  for (const [k, v] of Object.entries(local && typeof local === "object" ? local : {})) if (!SECRET_KEY.test(k) && typeof v === "string") loc[k] = v;
  const d = new Date(), name = `Sothis backup ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.json`;
  const r = await dialog.showSaveDialog(win, { title: "Save a Sothis backup", defaultPath: path.join(app.getPath("documents"), name), filters: [{ name: "Sothis backup", extensions: ["json"] }] });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  try { fs.writeFileSync(r.filePath, JSON.stringify({ app: "Sothis", v: 1, at: Date.now(), settings: copy, local: loc }, null, 1)); return { ok: true, file: path.basename(r.filePath) }; }
  catch (e) { return { ok: false, err: "Couldn't save the backup." }; }
});
ipcMain.handle("backup:import", async () => {
  const r = await dialog.showOpenDialog(win, { title: "Restore a Sothis backup", defaultPath: app.getPath("documents"), filters: [{ name: "Sothis backup", extensions: ["json"] }], properties: ["openFile"] });
  if (r.canceled || !r.filePaths || !r.filePaths[0]) return { ok: false, canceled: true };
  let data = null; try { data = JSON.parse(fs.readFileSync(r.filePaths[0], "utf8")); } catch {}
  if (!data || data.app !== "Sothis" || !data.settings || typeof data.settings !== "object") return { ok: false, err: "That file isn't a Sothis backup." };
  const keep = { discord: {}, obs: {} };   // your current secrets stay as they are
  for (const k of ["clientSecret", "accessToken", "refreshToken", "expiresAt"]) if (settings.discord && settings.discord[k] != null) keep.discord[k] = settings.discord[k];
  if (settings.obs && settings.obs.pass) keep.obs.pass = settings.obs.pass;
  const next = Object.assign({}, data.settings);
  next.discord = Object.assign({}, next.discord || {}, keep.discord);
  next.obs = Object.assign({}, next.obs || {}, keep.obs);
  for (const k of ["clientSecret", "accessToken", "refreshToken"]) if (next.discord[k] && !String(next.discord[k]).startsWith("enc:") && !keep.discord[k]) delete next.discord[k];
  settings = next; saveSettings();
  const loc = {}; for (const [k, v] of Object.entries(data.local || {})) if (!SECRET_KEY.test(k) && typeof v === "string") loc[k] = v;
  return { ok: true, local: loc };
});
ipcMain.handle("wd:team", () => settings.wdTeam || "");
ipcMain.handle("wd:teamSet", (_e, k) => wdTeamSet(k));
ipcMain.handle("ow:heroSet", (_e, name) => {
  name = String(name || "").slice(0, 40);
  if (!name) { owHero = null; dcPresence(); return { ok: true }; }
  owHero = { name, at: Date.now() };
  let learned = false;
  if (owPhase && (owPhase.kind === "menu" || owPhase.kind === "queue")) hudLast = null;   // nothing to learn from a menu screen
  if (hudLast && Date.now() - hudLast.at < 3 * 60000) { heroRefsGet().push({ name, v: hudLast.v, at: Date.now() }); heroRefsSave(); learned = true; owTeach = null; mapLog("learned the hero picture for " + name); }
  else { owTeach = { name, until: Date.now() + 15 * 60000 }; mapLog("will learn the hero picture for " + name + " once your HUD is on screen"); }
  dcPresence();
  return { ok: true, learned };
});
ipcMain.handle("ow:heroes", async () => {
  if (owHeroes) return owHeroes;
  const r = await owFetch("/heroes?locale=en-us");
  if (r.status === 200 && Array.isArray(r.json)) owHeroes = r.json.map(h => ({ key: h.key, name: h.name, portrait: h.portrait, role: h.role }));
  return owHeroes || [];
});

ipcMain.handle("win:get", () => winState());
ipcMain.handle("win:pin", (_e, on) => { setPinned(on); return isPinned(); });
ipcMain.handle("win:mini", (_e, on) => { setMini(on); return !!settings.mini; });
// Compact sidebar: a slim strip docked to the left or right edge of the screen
let preCompact = null;
const COMPACT_W = 76;
function compactPlace(y) {
  const d = screen.getDisplayMatching(win.getBounds()).workArea;
  const H = Math.min(660, d.height - 32);
  const x = settings.compactSide === "left" ? d.x + 6 : d.x + d.width - COMPACT_W - 6;
  const yy = Math.max(d.y + 6, Math.min(d.y + d.height - H - 6, typeof y === "number" ? y : (typeof settings.compactY === "number" ? settings.compactY : Math.round(d.y + (d.height - H) / 2))));
  win.setResizable(true); win.setBounds({ x, y: yy, width: COMPACT_W, height: H }, false); win.setResizable(false);
}
function compactSnap() {
  const b = win.getBounds(), d = screen.getDisplayMatching(b).workArea;
  settings.compactSide = b.x + b.width / 2 < d.x + d.width / 2 ? "left" : "right";
  settings.compactY = b.y; saveSettings();
  compactPlace(b.y); broadcast();
}
function setCompact(on) {
  if (!win || win.isDestroyed()) return;
  if (on) {
    if (settings.mini) settings.mini = false;
    if (preFull) { preFull = null; win.webContents.send("win:full", false); }
    if (!settings.compact) preCompact = win.getBounds();
    settings.compact = true;
    compactPlace();
  } else if (settings.compact) {
    settings.compact = false;
    // open the full window on the monitor the sidebar is on now (it may have been dragged to another screen)
    const sb = win.getBounds(), here = screen.getDisplayMatching(sb), wa = here.workArea;
    let nb = preCompact;
    if (!nb || screen.getDisplayMatching(nb).id !== here.id) {
      const sz = nb ? { w: nb.width, h: nb.height } : sizeFor(currentKey);
      const w = Math.min(Math.round(sz.w), wa.width), h = Math.min(Math.round(sz.h), wa.height);
      const x = settings.compactSide === "left" ? wa.x + 6 : wa.x + wa.width - w - 6;   // grow out from the edge the sidebar was on
      const y = Math.max(wa.y, Math.min(wa.y + wa.height - h, sb.y));
      nb = { x, y, width: w, height: h };
    }
    win.setResizable(true); win.setBounds(nb, false); win.setResizable(false); preCompact = null;
  }
  saveSettings(); broadcast();
}
ipcMain.handle("win:compact", (_e, on) => { setCompact(on === undefined ? !settings.compact : !!on); return !!settings.compact; });
ipcMain.handle("win:startup", (_e, on) => { setStartup(on); return isStartup(); });
ipcMain.on("win:layout", (_e, key) => {
  currentKey = key === "wide" ? "wide" : "main";
  if (!settings.mini && !preFull && !settings.compact) applySize(sizeFor(currentKey));   // stay fullscreen when switching tabs
});
ipcMain.on("win:resize", (_e, { w, h }) => {
  if (settings.mini || settings.compact) return;
  const min = MIN[currentKey];
  applySize({ w: Math.max(min.w, w), h: Math.max(min.h, h) });
});
ipcMain.on("win:resize-done", () => {
  if (settings.mini) return;
  const [w, h] = win.getSize();
  settings.sizes = Object.assign({}, settings.sizes, { [currentKey]: { w, h } });
  saveSettings();
});
// Fullscreen: fill the whole screen (works with the rounded, frameless window).
let preFull = null;
function setFull(on) {
  if (!win || win.isDestroyed()) return;
  if (on && !preFull) {
    preFull = win.getBounds();
    const d = screen.getDisplayMatching(preFull).workArea;   // stop above the taskbar
    win.setResizable(true); win.setBounds(d, false); win.setResizable(false);
  } else if (!on && preFull) {
    win.setResizable(true); win.setBounds(preFull, false); win.setResizable(false);
    preFull = null;
  }
  win.webContents.send("win:full", !!preFull);
}
ipcMain.on("win:fullscreen", (_e, on) => setFull(on === undefined ? !preFull : !!on));
ipcMain.on("win:move-by", (_e, delta = {}) => {
  if (!win || win.isDestroyed() || settings.mini || settings.compact || preFull) return;
  const b = win.getBounds(), d = screen.getDisplayMatching(b).workArea;
  const x = Math.max(d.x - b.width + 48, Math.min(d.x + d.width - 48, b.x + Math.round(Number(delta.dx) || 0)));
  const y = Math.max(d.y, Math.min(d.y + d.height - 24, b.y + Math.round(Number(delta.dy) || 0)));
  win.setPosition(x, y, false);
});
// Title bar drag: the window follows the mouse pointer itself (read here in screen coordinates), so it moves the same on
// every monitor and across monitors with different scaling; the size is held so Windows can't grow/shrink it on the way
let winDrag = null;
// smooth drag: while you hold the title bar, Sothis follows the mouse ~120 times a second on its own clock
// (not only when the page reports a move), and only moves when the mouse actually moved
function winDragTick() {
  if (!winDrag || !win || win.isDestroyed()) return;
  if (Date.now() - winDrag.t0 > 60000) { clearInterval(winDrag.timer); winDrag = null; return; }   // safety: a lost mouse-up never leaves it stuck to the pointer
  const c = screen.getCursorScreenPoint();
  if (c.x === winDrag.lx && c.y === winDrag.ly) return;
  winDrag.lx = c.x; winDrag.ly = c.y;
  let x = winDrag.x + c.x - winDrag.c.x, y = winDrag.y + c.y - winDrag.c.y;
  const wa = screen.getDisplayNearestPoint(c).workArea;   // keep the title bar reachable on the monitor the pointer is on
  y = Math.max(wa.y, Math.min(wa.y + wa.height - 24, y));
  win.setPosition(Math.round(x), Math.round(y), false);
}
ipcMain.on("win:drag", (_e, phase) => {
  if (!win || win.isDestroyed()) return;
  if (phase === "start") {
    if (settings.mini || settings.compact || preFull) { winDrag = null; return; }
    const b = win.getBounds(), c = screen.getCursorScreenPoint();
    clearInterval(winDrag && winDrag.timer);
    winDrag = { c, x: b.x, y: b.y, w: b.width, h: b.height, lx: c.x, ly: c.y, t0: Date.now() };
    winDrag.timer = setInterval(winDragTick, 8);
  } else if (phase === "move") winDragTick();
  else if (phase === "end" && winDrag) {
    clearInterval(winDrag.timer); winDragTick();
    const d = winDrag; winDrag = null;
    // moving onto a monitor with different scaling can nudge the size; put it back
    const b = win.getBounds(); if (b.width !== d.w || b.height !== d.h) win.setBounds({ x: b.x, y: b.y, width: d.w, height: d.h }, false);
  }
});
ipcMain.on("win:minimize", () => win.minimize());
ipcMain.on("win:close", () => win.hide());
ipcMain.on("app:quit", () => { quitting = true; app.quit(); });
ipcMain.on("open-external", (_e, url) => { if (/^https?:\/\//i.test(String(url))) shell.openExternal(url); });

app.on("second-instance", showWindow);
// Write each site's saved settings (Discord voice devices, sign-ins) to disk.
function flushSites() {
  for (const ses of [session.defaultSession, session.fromPartition("persist:discord"), session.fromPartition("persist:statscc"), session.fromPartition("persist:browser"), session.fromPartition("persist:ytm"), session.fromPartition("persist:claude"), session.fromPartition("persist:emu")]) {
    try { ses.flushStorageData(); } catch {}
    try { ses.cookies.flushStore().catch(() => {}); } catch {}
  }
}
app.on("session-end", flushSites);
let dockQuitDone = false;
app.on("before-quit", e => {
  quitting = true;
  // docked apps (Discord) go back to their own windows first, so nothing of theirs closes with Sothis
  if (!dockQuitDone) { const wait = dockReleaseAll(); if (wait) { e.preventDefault(); dockQuitDone = true; setTimeout(() => app.quit(), wait); return; } }
  flushSites();
  if (worker) worker.kill();
});
app.whenReady().then(() => {
  try { session.fromPartition("persist:watch").setPermissionRequestHandler((_wc, perm, cb) => cb(["fullscreen", "clipboard-sanitized-write"].includes(perm))); } catch {}
  const browserSession = session.fromPartition("persist:browser");
  const browserOk = new Set(["fullscreen", "clipboard-sanitized-write", "notifications", "media"]);
  browserSession.setPermissionRequestHandler((_wc, perm, cb) => cb(browserOk.has(perm)));
  // Browser tab: presents itself as Firefox, like the Music and Claude tabs. Google refuses sign-in from embedded
  // Chrome ("This browser or app may not be secure"); as Firefox, Google, YouTube and the rest let you sign in.
  const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0";
  try { browserSession.setUserAgent(BROWSER_UA); } catch {}
  browserSession.webRequest.onBeforeSendHeaders((details, cb) => {
    const h = details.requestHeaders;
    for (const k of Object.keys(h)) if (/^sec-ch-ua/i.test(k)) delete h[k];
    h["User-Agent"] = BROWSER_UA;
    cb({ requestHeaders: h });
  });
  // Browser ad blocker: requests to known ad and tracking servers are cancelled (list refreshed every few days)
  browserSession.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*"] }, (d, cb) => {
    if (settings.adBlock === false || d.resourceType === "mainFrame") return cb({});
    let host = ""; try { host = new URL(d.url).hostname.toLowerCase(); } catch { return cb({}); }
    if (!adIsBlocked(host)) return cb({});
    if (d.webContentsId) { const n = (adCounts.get(d.webContentsId) || 0) + 1; adCounts.set(d.webContentsId, n); adNotify(d.webContentsId, n); }
    cb({ cancel: true });
  });
  setTimeout(adListLoad, 4000);
  // Browser downloads go straight to your Downloads folder
  browserSession.on("will-download", (_e, item) => {
    try {
      const dir = app.getPath("downloads"), name = item.getFilename() || "download", ext = path.extname(name), base = path.basename(name, ext);
      try { fs.mkdirSync(dir, { recursive: true }); } catch {}
      let f = path.join(dir, name), n = 2;
      while (fs.existsSync(f)) f = path.join(dir, `${base} (${n++})${ext}`);
      item.setSavePath(f);
      const send = state => { if (win && !win.isDestroyed()) win.webContents.send("web:dl", { name: path.basename(f), path: f, state }); };
      send("start");
      item.once("done", (_ev, state) => send(state));
    } catch {}
  });
  const ytmSession = session.fromPartition("persist:ytm");
  // Google refuses sign-in from embedded Chrome windows; present this tab as Firefox (as other YouTube Music desktop apps do).
  const FIREFOX_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0";
  ytmSession.setUserAgent(FIREFOX_UA);
  ytmSession.webRequest.onBeforeSendHeaders((details, cb) => {
    const h = details.requestHeaders;
    for (const k of Object.keys(h)) if (/^sec-ch-ua/i.test(k)) delete h[k];
    h["User-Agent"] = FIREFOX_UA;
    cb({ requestHeaders: h });
  });
  // Claude tab: its own sign-in; same Firefox identity so "Continue with Google" works
  const claudeSession = session.fromPartition("persist:claude");
  claudeSession.setUserAgent(FIREFOX_UA);
  claudeSession.webRequest.onBeforeSendHeaders({ urls: ["https://accounts.google.com/*", "https://*.google.com/*"] }, (details, cb) => {
    const h = details.requestHeaders;
    for (const k of Object.keys(h)) if (/^sec-ch-ua/i.test(k)) delete h[k];
    h["User-Agent"] = FIREFOX_UA;
    cb({ requestHeaders: h });
  });
  const claudeOk = new Set(["fullscreen", "clipboard-sanitized-write", "notifications", "media"]);
  claudeSession.setPermissionRequestHandler((_wc, perm, cb) => cb(claudeOk.has(perm)));
  const ytmOk = new Set(["fullscreen", "clipboard-sanitized-write", "notifications"]);
  ytmSession.setPermissionRequestHandler((_wc, perm, cb) => cb(ytmOk.has(perm)));
  const discordSession = session.fromPartition("persist:discord");
  // Block the passkey pop-up on embedded sites without breaking their sign-in pages.
  for (const p of ["persist:discord", "persist:ytm", "persist:statscc", "persist:browser"]) {
    try { session.fromPartition(p).setPreloads([path.join(__dirname, "nopasskey-preload.js")]); } catch {}
  }
  const allowed = new Set(["media", "speaker-selection", "notifications", "clipboard-sanitized-write", "fullscreen"]);
  discordSession.setPermissionRequestHandler((_wc, perm, cb) => cb(allowed.has(perm)));
  discordSession.setPermissionCheckHandler((_wc, perm) => allowed.has(perm));
  settings = loadSettings();
  secretsTidy();
  // clip sound: the Sothis window records your system sound (loopback) without asking each time
  try { session.defaultSession.setDisplayMediaRequestHandler((_req, cb) => { desktopCapturer.getSources({ types: ["screen"] }).then(src => cb(src[0] ? { video: src[0], audio: "loopback" } : {})).catch(() => cb({})); }); } catch {}
  delete settings.compact;   // always open as the full window
  delete settings.ciderAuto; delete settings.ciderQuit;   // old Cider options
  if (!settings.bigger || settings.bigger < 3) { if (settings.sizes) { delete settings.sizes.main; delete settings.sizes.wide; } settings.bigger = 3; saveSettings(); }   // one-time: back to the full default sizes (the shared copy saved smaller ones)
  createWindow();
  createTray();
  setTimeout(r6RegisterKey, 1500);
  csGsiServer(); setTimeout(csGsiInstall, 8000);
  setInterval(flushSites, 30000);
  setTimeout(refreshBattery, 1500);
  setTimeout(dcConnect, 2500);
  setTimeout(startUpdateWatch, 5000);
  // one-time clean-up: the old "Sothis Share" copy (app and its data) goes to the Recycle Bin
  setTimeout(async () => {
    if (settings.shareCleaned || process.platform !== "win32") return;
    const L = process.env.LOCALAPPDATA || "", R = app.getPath("appData");
    let done = true;
    for (const d of [path.join(L, "Programs", "Sothis Share"), path.join(R, "Sothis Share")]) {
      if (!fs.existsSync(d) || path.resolve(d) === path.resolve(DATA_DIR) || path.resolve(__dirname).startsWith(path.resolve(d))) continue;
      try { await shell.trashItem(d); presLog("cleaned up old copy: " + d); } catch (e) { done = false; presLog("couldn't remove old copy " + d + ": " + (e && e.message)); }
    }
    if (done) { settings.shareCleaned = true; saveSettings(); }
  }, 9000);
  setInterval(refreshBattery, BATTERY_INTERVAL);
  try { extrasStart(); } catch {}
});
app.on("window-all-closed", () => {});

/* =====================================================================================================
   Game sessions · queue-pop alert · music ducking · retro games
   ===================================================================================================== */

/* ---------- Game sessions: notice when a game starts and stops, then leave a recap on Home ---------- */
let sess = null, trkMiss = 0, trkLast = 0;
const rankNow = g => {
  const gr = settings.gameRanks || {};
  if (g === "Rainbow Six Siege") return settings.r6RankName ? { name: settings.r6RankName, rp: typeof settings.r6RP === "number" ? settings.r6RP : null } : null;
  if (g === "Overwatch 2") return gr.ow ? { name: gr.ow } : null;
  if (g === "Counter-Strike 2") return gr.cs ? { name: gr.cs } : null;
  return null;
};
// a session that was running when Sothis last closed: pick it back up (it ends normally if the game is gone)
let sessRestored = false;
function sessRestore() {
  sessRestored = true;
  const L = settings.sessLive;
  if (!sess && L && L.game && L.start && Date.now() - (L.last || 0) < 6 * 3600000) { sess = { game: L.game, exe: L.exe, start: L.start, maps: Array.isArray(L.maps) ? L.maps : [], rank0: L.rank0 || null }; trkLast = L.last; }
  else if (L && !sess) { delete settings.sessLive; saveSettings(); }
}
async function trkPoll() {
  if (!sessRestored) sessRestore();
  if (process.platform !== "win32") return;
  let run; try { run = await runningSet(); } catch { return; }
  let name = null, exe = null;
  for (const [e, n] of Object.entries(GAME_EXES)) if (run.has(e)) { name = n; exe = e; break; }
  // any other Steam game that's running (e.g. Wardogs) counts too
  if (!name && dcGame && dcGame.sid && dcGame.name && dcGame.name !== "a Steam game") { name = dcGame.name; exe = "steam:" + dcGame.sid; }
  const now = Date.now();
  if (name) {
    trkMiss = 0; trkLast = now;
    if (sess && sess.game !== name) sessEnd();
    if (!sess) { sess = { game: name, exe, start: now, maps: [], rank0: rankNow(name) }; if (win && !win.isDestroyed()) win.webContents.send("session:start", { game: name, start: now }); dcGamePoll(); }
    if ((settings.clips || {}).on !== false) { const C = clipper(), st = C.state(); if (!st.recording && st.phase !== "setup") C.start(); }
    sessMaps();
    // keep the session on disk too, so a Sothis restart mid-game doesn't lose its recap
    if (!settings.sessLive || now - (settings.sessLive.last || 0) > 60000 || settings.sessLive.start !== sess.start) { settings.sessLive = { game: sess.game, exe: sess.exe, start: sess.start, maps: sess.maps.slice(-12), rank0: sess.rank0, last: now }; saveSettings(); }
  } else if (sess && ++trkMiss >= (/^steam:/.test(sess.exe || "") ? 4 : 2)) sessEnd();
  try { qpEnsure(); } catch {}
  try { duckEval(); } catch {}
}
function sessMaps() {
  if (!sess) return;
  const add = m => {
    if (!m || !m.name || m.at < sess.start) return;
    if (sess.maps[sess.maps.length - 1] !== m.name) sess.maps.push(m.name);
    const img = mapPicture(sess.game); if (img) { sess.mapImgs = sess.mapImgs || {}; sess.mapImgs[m.name] = img; }
  };
  if (sess.game === "Overwatch 2") add(owMapNow);
  else if (sess.game === "Rainbow Six Siege") add(r6MapNow);
  else if (sess.game === "Counter-Strike 2" && csLive) add({ name: csLive.map, at: csLive.at });
  if (sess.maps.length > 30) sess.maps = sess.maps.slice(-30);
}
function sessEnd() {
  const s = sess; sess = null;
  try { if (clipperObj) clipperObj.stop(); } catch {}
  if (settings.sessLive) { delete settings.sessLive; saveSettings(); }
  if (!s) return;
  // the game is gone: clear its map and update your Discord status straight away
  if (s.game === "Overwatch 2") owMapNow = null; else if (s.game === "Rainbow Six Siege") r6MapNow = null; else if (s.game === "Counter-Strike 2") csLive = null;
  dcGamePoll();
  if (win && !win.isDestroyed()) win.webContents.send("session:stop", { game: s.game });
  const end = trkLast || Date.now();
  settings.sessHist = (settings.sessHist || []).concat([{ game: s.game, start: s.start, end }]).slice(-60); saveSettings();
  setTimeout(clipsSortLoose, 3 * 60000);   // clips saved right at the end get sorted once Medal has finished them
  if (end - s.start < 3 * 60000) return;   // too short to be worth a recap
  const clips = [];
  const walk = (d, depth) => {
    let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { if (depth < 2 && !/^(thumbnails|screenshots|\.)/i.test(e.name)) walk(f, depth + 1); continue; }
      if (!VID_RE.test(e.name)) continue;
      try { const st = fs.statSync(f); if (st.mtimeMs >= s.start && st.mtimeMs <= end + 3 * 60000) clips.push({ name: e.name.replace(VID_RE, ""), path: f, url: require("url").pathToFileURL(f).href, at: st.mtimeMs }); } catch {}
    }
  };
  walk(clipsDir(), 0);
  clips.sort((a, b) => b.at - a.at);
  const rec = { game: s.game, start: s.start, end, maps: s.maps.slice(-12), mapImgs: s.mapImgs || {}, clips: clips.length, clipList: clips.slice(0, 3), rank0: s.rank0 };
  settings.lastSession = rec; saveSettings();
  if (win && !win.isDestroyed()) win.webContents.send("session:end", rec);
}
ipcMain.handle("session:last", () => settings.lastSession || null);
ipcMain.handle("session:now", () => sess ? { game: sess.game, start: sess.start } : null);
// What the Home banner shows while you play: map (with its picture), mode and rank
const STEAM_IDS = { "Overwatch 2": 2357570, "Rainbow Six Siege": 359550, "Counter-Strike 2": 730, "Marvel Rivals": 2767030, "PUBG": 578080, "Palworld": 1623730, "Elden Ring": 1245620, "GTA V": 271590, "Red Dead Redemption 2": 1174180, "7 Days to Die": 251570, "Vampire Survivors": 1794680, "FragPunk": 2943650, "The Witcher 3": 292030, "Skyrim": 489830, "Fallout 4": 377160 };
ipcMain.handle("session:live", () => {
  if (!sess) return null;
  const g = sess.game, gr = settings.gameRanks || {};
  let map = "", mode = "", rank = "";
  if (g === "Overwatch 2") { if (owMapNow && Date.now() - owMapNow.at < 45 * 60000) { map = owMapNow.name; mode = owMapNow.mode || ""; } rank = owRankNow(); if (owHero && !(owPhase && (owPhase.kind === "menu" || owPhase.kind === "queue"))) rank = owHero.name + (rank ? " · " + rank : ""); }
  else if (g === "Rainbow Six Siege") { if (r6MapNow && Date.now() - r6MapNow.at < 45 * 60000) map = r6MapNow.name; rank = settings.r6RankName ? String(settings.r6RankName).replace(/^(no rank|not ranked)$/i, "Unranked") + (typeof settings.r6RP === "number" ? " · " + Number(settings.r6RP).toLocaleString("en-US") + " RP" : "") : ""; }
  else if (/^wardogs\b/i.test(g || "")) { map = wdTeamName(); if (wdCash && Date.now() - wdCash.at < 10 * 60000) rank = wdCash.txt; }
  else if (g === "Counter-Strike 2") { if (csLive && Date.now() - csLive.at < 90000) { map = csLive.map; mode = csLive.score || ""; } rank = gr.cs || ""; }
  const sid = STEAM_IDS[g] || (/^steam:(\d+)$/.exec(sess.exe || "") || [])[1];
  return { game: g, start: sess.start, map, mode, rank, mapImg: map ? mapPicture(g) : "",
    art: sid ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${sid}/library_hero.jpg` : "", artAlt: sid ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${sid}/header.jpg` : "" };
});
ipcMain.handle("session:dismiss", () => { delete settings.lastSession; saveSettings(); return true; });
ipcMain.handle("session:save", (_e, extra) => {
  // the page adds what it worked out from the stats sites (wins, losses, rank change)
  if (settings.lastSession && extra && typeof extra === "object") { settings.lastSession.extra = extra; saveSettings(); }
  return true;
});

/* ---------- Queue-pop alert: games flash their taskbar button when a match is found while you're tabbed out ---------- */
const qpOn = () => settings.qpop !== false;
let qpProc = null, qpBuf = "", qpLast = {}, qpWin = null, qpReady = false, qpData = null, qpHideT = null;
function qpEnsure() {
  if (process.platform !== "win32") return;
  const need = qpOn() && !!sess;
  if (need) { fgWatch(); if (!qpProc) qpStart(); }
  else if (qpProc) { try { qpProc.kill(); } catch {} qpProc = null; }
}
function qpStart() {
  try {
    qpProc = require("child_process").spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-STA", "-File", path.join(__dirname, "qpop-helper.ps1")], { windowsHide: true });
  } catch { qpProc = null; return; }
  qpBuf = "";
  qpProc.stdout.setEncoding("utf8");
  qpProc.stdout.on("data", d => {
    qpBuf += d; const lines = qpBuf.split(/\r?\n/); qpBuf = lines.pop();
    for (const ln of lines) { const [kind, exe, hwnd] = ln.trim().split("|"); if (kind === "flash") qpFlash(String(exe || "").toLowerCase(), hwnd); }
  });
  const me = qpProc;
  qpProc.on("exit", () => { if (qpProc === me) qpProc = null; });
}
function qpFlash(exe, hwnd) {
  const game = GAME_EXES[exe];
  if (!game || !qpOn()) return;
  if (String(fgNow.name || "").toLowerCase() === exe) return;          // you're already looking at it
  if (sess && sess.exe === exe && Date.now() - sess.start < 90000) return;   // still starting up
  if (Date.now() - (qpLast[exe] || 0) < 25000) return;                 // one alert per pop
  qpLast[exe] = Date.now();
  qpShow({ game, hwnd: /^\d+$/.test(hwnd || "") ? hwnd : "" });
}
function qpShow(d) {
  qpData = d;
  try { phEvent("match", { game: d.game || "", test: !!d.test }); } catch {}
  duckHoldUntil = Date.now() + 5000; try { duckEval(); } catch {}   // let the alert be heard
  if (!qpWin || qpWin.isDestroyed()) {
    qpReady = false;
    qpWin = new BrowserWindow({
      width: 440, height: 130, show: false, frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false,
      fullscreenable: false, skipTaskbar: true, focusable: false, hasShadow: false, alwaysOnTop: true, backgroundColor: "#00000000",
      webPreferences: { preload: path.join(__dirname, "qpop-preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, autoplayPolicy: "no-user-gesture-required" }
    });
    qpWin.setAlwaysOnTop(true, "screen-saver");
    qpWin.setVisibleOnAllWorkspaces(true);
    qpWin.loadFile(path.join(__dirname, "qpop.html"));
    qpWin.webContents.on("did-finish-load", () => { qpReady = true; if (qpData) qpPaint(); });
    qpWin.on("closed", () => { qpWin = null; qpReady = false; });
  } else if (qpReady) qpPaint();
}
function qpPaint() {
  if (!qpWin || qpWin.isDestroyed() || !qpData) return;
  const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  qpWin.setBounds({ x: Math.round(wa.x + (wa.width - 440) / 2), y: wa.y + 20, width: 440, height: 130 });
  qpWin.webContents.send("qp:show", { game: qpData.game, canGo: !!qpData.hwnd, test: !!qpData.test });
  qpWin.showInactive(); qpWin.setAlwaysOnTop(true, "screen-saver");
  clearTimeout(qpHideT); qpHideT = setTimeout(qpHide, 20000);
}
function qpHide() { clearTimeout(qpHideT); if (qpWin && !qpWin.isDestroyed()) qpWin.hide(); }
ipcMain.on("qp:go", () => {
  if (qpData && qpData.hwnd) { qpEnsure(); if (qpProc) try { qpProc.stdin.write("focus " + qpData.hwnd + "\n"); } catch {} }
  qpHide();
});
ipcMain.on("qp:close", qpHide);
ipcMain.handle("qp:get", () => qpOn());
ipcMain.handle("qp:set", (_e, on) => { settings.qpop = !!on; saveSettings(); qpEnsure(); return qpOn(); });
ipcMain.handle("qp:test", () => { qpShow({ game: sess ? sess.game : "Overwatch 2", hwnd: "", test: true }); return true; });

/* ---------- Music ducking: turn Sothis down while a game is in front or someone talks in your Discord call ---------- */
const duckCfg = () => Object.assign({ game: false, talk: true, level: 0.35 }, settings.duck || {});
let duckOn = false, duckBase = null, duckBusy = false, duckTalk = false, duckTalkT = null, duckHoldUntil = 0, duckHoldT = null;
function duckSignal() {
  if (fgNow && /^azahar\.exe$/i.test(fgNow.name || "") && fgNow.path && settings.azahar !== fgNow.path) { settings.azahar = fgNow.path; saveSettings(); }
  const ch = dc.channel;
  const others = !!ch && [...ch.members.values()].some(m => !m.me && dc.speaking.has(m.id));
  if (others) { clearTimeout(duckTalkT); duckTalkT = null; if (!duckTalk) duckTalk = true; }
  else if (duckTalk && !duckTalkT) duckTalkT = setTimeout(() => { duckTalkT = null; duckTalk = false; duckEval(); }, 1400);
  duckEval();
}
function duckEval() {
  if (process.platform !== "win32" || !settings) return;
  const c = duckCfg();
  if (c.game) fgWatch();
  const held = Date.now() < duckHoldUntil;
  if (held && !duckHoldT) duckHoldT = setTimeout(() => { duckHoldT = null; duckEval(); }, duckHoldUntil - Date.now() + 50);
  const want = !held && ((c.game && isGameFg(fgNow)) || (c.talk && duckTalk && !!dc.channel));
  duckApply(want);
}
async function duckRamp(from, to) {
  for (let i = 1; i <= 4; i++) { await mixCmd(`set ${(from + (to - from) * i / 4).toFixed(3)} Sothis`); }
}
async function duckApply(want) {
  if (duckBusy || want === duckOn) return;
  duckBusy = true;
  try {
    if (want) {
      const list = await mixCmd("list");
      const me = Array.isArray(list) && list.find(a => /^sothis$/i.test(a.name));
      if (me && me.vol > 0.02) {
        duckBase = me.vol; settings.duckBase = duckBase; saveSettings();
        await duckRamp(duckBase, duckBase * Math.max(0.05, Math.min(0.9, duckCfg().level)));
        duckOn = true;
      }
    } else {
      if (duckBase != null) await duckRamp(duckBase * duckCfg().level, duckBase);
      duckOn = false; duckBase = null; delete settings.duckBase; saveSettings();
    }
  } catch {} finally { duckBusy = false; }
  setTimeout(() => { try { duckEval(); } catch {} }, 50);   // catch up if things changed meanwhile
}
// If Sothis closed while the music was turned down, put it back.
function duckRestore(tries = 0) {
  if (typeof settings.duckBase !== "number" || duckOn) return;
  mixCmd(`set ${settings.duckBase.toFixed(3)} Sothis`).then(r => {
    if (r && r.hit > 0) { delete settings.duckBase; saveSettings(); }
    else if (tries < 40) setTimeout(() => duckRestore(tries + 1), 15000);
  });
}
app.on("before-quit", () => { if (duckOn && duckBase != null) { try { mix && mix.stdin.write(`set ${duckBase.toFixed(3)} Sothis\n`); } catch {} } });
ipcMain.handle("duck:get", () => duckCfg());
ipcMain.handle("duck:set", (_e, patch) => {
  const p = patch || {}, c = duckCfg();
  if (typeof p.game === "boolean") c.game = p.game;
  if (typeof p.talk === "boolean") c.talk = p.talk;
  if (typeof p.level === "number" && isFinite(p.level)) c.level = Math.max(0.05, Math.min(0.9, p.level));
  settings.duck = c; saveSettings();
  if (duckOn && duckBase != null) mixCmd(`set ${(duckBase * c.level).toFixed(3)} Sothis`);
  duckEval();
  return c;
});

/* ---------- Retro games: your own game files played in Sothis (EmulatorJS), 3DS games opened in Azahar ---------- */
const ROM_SYS = [
  { re: /\.(nes|fds|unf|unif)$/i, sys: "NES", core: "fceumm", lib: "Nintendo - Nintendo Entertainment System", hint: /\b(nes|famicom)\b/i },
  { re: /\.(sfc|smc)$/i, sys: "SNES", core: "snes9x", lib: "Nintendo - Super Nintendo Entertainment System", hint: /\b(snes|super ?nintendo|super ?famicom)\b/i },
  { re: /\.gbc$/i, sys: "GBC", core: "gambatte", lib: "Nintendo - Game Boy Color", hint: /\b(gbc|game ?boy ?color)\b/i },
  { re: /\.gb$/i, sys: "Game Boy", core: "gambatte", lib: "Nintendo - Game Boy", hint: /\b(gb|game ?boy)\b/i },
  { re: /\.gba$/i, sys: "GBA", core: "mgba", lib: "Nintendo - Game Boy Advance", hint: /\b(gba|game ?boy ?advance)\b/i },
  { re: /\.nds$/i, sys: "DS", core: "melonds", lib: "Nintendo - Nintendo DS", hint: /\b(nds|ds|nintendo ds)\b/i },
  { re: /\.(n64|z64|v64)$/i, sys: "N64", core: "mupen64plus_next", lib: "Nintendo - Nintendo 64", hint: /\b(n64|nintendo ?64)\b/i },
  { re: /\.(chd|pbp|cue)$/i, sys: "PS1", core: "pcsx_rearmed", lib: "Sony - PlayStation", hint: /\b(ps1|psx|psone|playstation ?1?)\b/i },
  { re: /\.(md|gen|smd)$/i, sys: "Genesis", core: "genesis_plus_gx", lib: "Sega - Mega Drive - Genesis", hint: /\b(genesis|mega ?drive|md)\b/i },
  { re: /\.sms$/i, sys: "Master System", core: "genesis_plus_gx", lib: "Sega - Master System - Mark III", hint: /\b(sms|master ?system)\b/i },
  { re: /\.gg$/i, sys: "Game Gear", core: "genesis_plus_gx", lib: "Sega - Game Gear", hint: /\b(gg|game ?gear)\b/i },
];
const romTokens = new Map();
const romTok = f => require("crypto").createHash("sha1").update(f.toLowerCase()).digest("hex").slice(0, 20);
// Your picked folders, plus any "Roms" folder found in your user folder or at the top of any drive (like D:\\Roms)
let romAutoCache = null, romAutoAt = 0;
function romAutoDirs() {
  if (romAutoCache && Date.now() - romAutoAt < 60000) return romAutoCache;
  const H = app.getPath("home"), out = [];
  const cands = [H, app.getPath("documents"), app.getPath("desktop"), app.getPath("downloads")];
  for (let c = 67; c <= 90; c++) cands.push(String.fromCharCode(c) + ":\\");
  for (const base of cands) {
    let ents = []; try { ents = fs.readdirSync(base, { withFileTypes: true }); } catch { continue; }
    const hit = ents.find(e => e.isDirectory() && /^roms?$/i.test(e.name));
    if (hit) out.push(path.join(base, hit.name));
  }
  romAutoCache = out; romAutoAt = Date.now();
  return out;
}
// The folders Azahar's own game list uses (and the folders of games you opened recently in Azahar)
function azaharGameDirs() {
  const out = [];
  try {
    const ini = fs.readFileSync(path.join(app.getPath("appData"), "Azahar", "config", "qt-config.ini"), "utf8");
    const clean = v => v.trim().replace(/^"|"$/g, "").replace(/\//g, "\\");
    for (const m of ini.matchAll(/^Paths\\gamedirs\\\d+\\path=(.+)$/gm)) {
      const d = clean(m[1]);
      if (!/^(INSTALLED|SYSTEM)$/i.test(d) && fs.existsSync(d)) out.push(d);
    }
    const rf = ini.match(/^Paths\\recentFiles=(.+)$/m);
    if (rf) for (const part of rf[1].match(/"[^"]+"|[^,]+/g) || []) {
      const f = clean(part);
      if (f && fs.existsSync(f)) out.push(path.dirname(f));
    }
  } catch {}
  return out;
}
function romDirs() {
  const saved = Array.isArray(settings.romDirs) ? settings.romDirs.filter(d => typeof d === "string") : [];
  const removed = (Array.isArray(settings.romDirsRemoved) ? settings.romDirsRemoved : []).map(d => d.toLowerCase());
  return [...saved, ...romAutoDirs().filter(d => !removed.includes(d.toLowerCase()))]
    .filter((d, i, a) => a.findIndex(x => x.toLowerCase() === d.toLowerCase()) === i && fs.existsSync(d));
}
/* Japanese titles shown (and boxart picked) under their English names */
const ROM_EN = [
  { re: /fuuin no tsurugi/i, en: "Fire Emblem - The Binding Blade", art: "Fire Emblem - The Binding Blade (USA).png" },
  { re: /rekka no ken/i, en: "Fire Emblem", art: "Fire Emblem (USA, Australia).png" },
  { re: /seima no kouseki/i, en: "Fire Emblem - The Sacred Stones", art: "Fire Emblem - The Sacred Stones (USA, Australia).png" },
];
const romEn = (n) => { const m = ROM_EN.find(x => x.re.test(n)); return m ? m.en + (/(\(patched\)|\(t\))/i.test(n) ? " (patched)" : "") : n; };
function romScan() {
  const items = [], seen = new Set();
  const cueBin = f => { try { const m = fs.readFileSync(f, "utf8").match(/FILE\s+"([^"]+)"/i); const b = m && path.join(path.dirname(f), m[1]); return b && fs.existsSync(b) ? b : ""; } catch { return ""; } };
  const walk = (d, depth, hintSys) => {
    let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    const here = ROM_SYS.find(x => x.hint.test(path.basename(d).replace(/[_\-.]+/g, " "))) || hintSys;
    for (const e of ents) {
      if (items.length >= 3000) return;
      const f = path.join(d, e.name);
      if (e.isDirectory()) { if (depth < 4 && !/^(\.|\$|saves?$|states?$|bios$|screenshots$)/i.test(e.name)) walk(f, depth + 1, here); continue; }
      let sys = ROM_SYS.find(x => x.re.test(e.name)), play = f;
      if (!sys && /\.(zip|7z)$/i.test(e.name) && here && !here.azahar) sys = here;
      if (!sys) continue;
      if (/\.cue$/i.test(e.name)) { play = cueBin(f); if (!play) continue; }
      const key = f.toLowerCase(); if (seen.has(key)) continue; seen.add(key);
      let size = 0; try { size = fs.statSync(play).size; } catch {}
      const tok = romTok(play); romTokens.set(tok, play);
      items.push({ token: tok, name: romEn(e.name.replace(/\.[^.]+$/, "")), file: path.basename(play), sys: sys.sys, core: sys.core || "", azahar: !!sys.azahar, lib: sys.lib, size, dir: d });
    }
  };
  const dirs = romDirs();
  for (const d of dirs) walk(d, 0, null);
  items.sort((a, b) => a.name.localeCompare(b.name));
  return { dirs, picked: true, items, azahar: !!azaharPath() };
}
function azaharPath() {
  if (settings.azahar && fs.existsSync(settings.azahar)) return settings.azahar;
  const L = process.env.LOCALAPPDATA || "", PF = process.env.ProgramFiles || "C:\\Program Files", PF86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", H = app.getPath("home");
  const cands = [path.join(PF, "Azahar", "azahar.exe"), path.join(PF, "Azahar", "azahar-qt.exe"), path.join(L, "Programs", "Azahar", "azahar.exe"), path.join(L, "Azahar", "azahar.exe"), path.join(PF86, "Azahar", "azahar.exe"),
    path.join(H, "Azahar", "azahar.exe"), path.join(app.getPath("desktop"), "Azahar", "azahar.exe"), path.join(app.getPath("downloads"), "Azahar", "azahar.exe")];
  let hit = cands.find(p => { try { return fs.existsSync(p); } catch { return false; } });
  if (!hit) { try { const l = launchers().find(x => /azahar\.exe$/i.test(x.path || "")); if (l && fs.existsSync(l.path)) hit = l.path; } catch {} }
  if (!hit) {
    // a Start menu shortcut tells us where it lives
    const menus = [path.join(process.env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs"), path.join(process.env.ProgramData || "C:\\ProgramData", "Microsoft", "Windows", "Start Menu", "Programs")];
    const look = (d, depth) => { let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return ""; }
      for (const e of ents) { const f = path.join(d, e.name);
        if (e.isDirectory() && depth < 2) { const r = look(f, depth + 1); if (r) return r; }
        else if (/azahar.*\.lnk$/i.test(e.name)) { try { const t = shell.readShortcutLink(f).target; if (t && fs.existsSync(t)) return t; } catch {} } }
      return ""; };
    for (const m of menus) { hit = look(m, 0); if (hit) break; }
  }
  if (hit) { settings.azahar = hit; saveSettings(); }
  return hit || "";
}
let emuWin = null, emuGame = null;
function openEmu(it) {
  if (emuWin && !emuWin.isDestroyed()) { emuWin.destroy(); emuWin = null; }
  const b = settings.emuWin || {};
  const okPos = typeof b.x === "number" && screen.getAllDisplays().some(d => b.x >= d.workArea.x - 50 && b.x < d.workArea.x + d.workArea.width && b.y >= d.workArea.y - 20 && b.y < d.workArea.y + d.workArea.height);
  emuWin = new BrowserWindow(Object.assign({
    width: b.w || 960, height: b.h || 720, minWidth: 400, minHeight: 300, backgroundColor: "#0b0b0f", title: it.name + " · " + it.sys, show: false,
    icon: path.join(__dirname, "icon.png"), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "emu-preload.js"), partition: "persist:emu", contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, autoplayPolicy: "no-user-gesture-required" }
  }, okPos ? { x: b.x, y: b.y } : {}));
  emuWin.setMenuBarVisibility(false);
  const q = new URLSearchParams({ core: it.core, name: it.name, sys: it.sys, rom: "sothisemu://app/rom/" + it.token + "/" + encodeURIComponent(it.file) });
  emuWin.loadURL("sothisemu://app/emu.html?" + q.toString());
  emuWin.once("ready-to-show", () => emuWin && emuWin.show());
  emuGame = { name: "Retro: " + it.name + " (" + it.sys + ")", img: "" };
  const w = emuWin;
  try { if (!libKeyOf.has(it.token)) libBuild().then(() => libPlayStart(it.token)).catch(() => {}); else libPlayStart(it.token); } catch {}
  let saved = false;
  w.on("close", e => {
    if (saved) return;
    e.preventDefault();   // give the game a moment to write its save file
    try { w.webContents.send("emu:closing"); } catch {}
    setTimeout(() => { saved = true; if (!w.isDestroyed()) w.close(); }, 4000);
  });
  ipcMain.removeAllListeners("emu:saved");
  ipcMain.on("emu:saved", ev => { if (!w.isDestroyed() && ev.sender === w.webContents) { const wc = w.webContents; Promise.race([rsBackupOne(wc), new Promise(r => setTimeout(r, 3000))]).catch(() => {}).finally(() => { saved = true; if (!w.isDestroyed()) w.close(); }); } });
  const remember = () => { if (w.isDestroyed() || w.isFullScreen() || w.isMaximized()) return; const r = w.getBounds(); settings.emuWin = { x: r.x, y: r.y, w: r.width, h: r.height }; saveSettings(); };
  w.on("moved", remember); w.on("resized", remember);
  w.on("closed", () => { if (emuWin === w) { emuWin = null; emuGame = null; dcGamePoll(); } try { libPlayStop(); } catch {} });
  dcGamePoll();
}
ipcMain.handle("emu:list", () => { try { return romScan(); } catch (e) { return { dirs: [], items: [], error: String(e.message || e) }; } });
ipcMain.handle("emu:addDir", async () => {
  const r = await dialog.showOpenDialog(win, { title: "Pick a folder with your game files", properties: ["openDirectory"] });
  if (r.canceled || !r.filePaths || !r.filePaths[0]) return false;
  const cur = Array.isArray(settings.romDirs) ? settings.romDirs : [];
  if (!cur.some(d => d.toLowerCase() === r.filePaths[0].toLowerCase())) settings.romDirs = cur.concat(r.filePaths[0]);
  settings.romDirsRemoved = (settings.romDirsRemoved || []).filter(x => x.toLowerCase() !== r.filePaths[0].toLowerCase());
  saveSettings(); return true;
});
ipcMain.handle("emu:removeDir", (_e, d) => {
  settings.romDirs = (Array.isArray(settings.romDirs) ? settings.romDirs : []).filter(x => x !== d);
  if (romAutoDirs().some(x => x.toLowerCase() === String(d).toLowerCase())) settings.romDirsRemoved = [...new Set([...(settings.romDirsRemoved || []), d])];
  saveSettings(); return true;
});
ipcMain.handle("emu:pickAzahar", async () => {
  const r = await dialog.showOpenDialog(win, { title: "Find azahar.exe", properties: ["openFile"], filters: [{ name: "Azahar", extensions: ["exe"] }] });
  if (r.canceled || !r.filePaths || !r.filePaths[0]) return false;
  settings.azahar = r.filePaths[0]; saveSettings(); return true;
});
ipcMain.handle("emu:play", async (_e, token, mode) => {
  const f = romTokens.get(String(token || ""));
  if (!f || !fs.existsSync(f)) return { ok: false, err: "That game file isn't there any more." };
  const sys = ROM_SYS.find(x => x.re.test(f)) || null;
  const scan = romScan(); const it = scan.items.find(x => x.token === token);
  if (!it) return { ok: false, err: "That game file isn't there any more." };
  if (it.azahar || (sys && sys.azahar)) {
    const exe = azaharPath();
    if (!exe) return { ok: false, err: "noazahar" };
    try { openAzahar(exe, f, it.name); return { ok: true, azahar: true }; }
    catch (e) { return { ok: false, err: "Couldn't open Azahar." }; }
  }
  if (mode !== "window") {
    const q = new URLSearchParams({ core: it.core, name: it.name, sys: it.sys, rom: "sothisemu://app/rom/" + it.token + "/" + encodeURIComponent(it.file) });
    return { ok: true, inline: true, url: "sothisemu://app/emu.html?" + q.toString() };
  }
  openEmu(it);
  return { ok: true };
});
// a game playing inside the Sothis window (for your Discord status)
ipcMain.on("emu:inline", (_e, name) => { emuGame = name ? { name: "Retro: " + String(name).slice(0, 80), img: "" } : null; dcGamePoll(); });
// 3DS: Azahar docked inside a Sothis window (Sothis's own window is see-through, which can't hold another program)
let azaWin = null, azaHelper = null, azaProc = null, azaClosing = false;
function azaRect() {
  if (!azaWin || azaWin.isDestroyed()) return null;
  const sf = screen.getDisplayMatching(azaWin.getBounds()).scaleFactor || 1, [cw, ch] = azaWin.getContentSize(), bar = 40;
  return [0, Math.round(bar * sf), Math.max(1, Math.round(cw * sf)), Math.max(1, Math.round((ch - bar) * sf))];
}
function azaSend(line) { try { azaHelper && azaHelper.stdin.write(line + "\n"); } catch {} }
function azaMove() { const r = azaRect(); if (r) azaSend("move " + r.join(" ")); }
function azaKill() {
  try { azaHelper && azaHelper.kill(); } catch {} azaHelper = null;
  if (azaProc && azaProc.exitCode === null) { try { execFile("taskkill", ["/pid", String(azaProc.pid), "/t", "/f"], { windowsHide: true }); } catch {} }
  azaProc = null;
}
function openAzahar(exe, file, name) {
  if (azaWin && !azaWin.isDestroyed()) { azaKill(); azaWin.destroy(); azaWin = null; }
  azaClosing = false;
  const b = settings.azaWin || {};
  const okPos = typeof b.x === "number" && screen.getAllDisplays().some(d => b.x >= d.workArea.x - 50 && b.x < d.workArea.x + d.workArea.width && b.y >= d.workArea.y - 20 && b.y < d.workArea.y + d.workArea.height);
  const w = azaWin = new BrowserWindow(Object.assign({
    width: b.w || 1000, height: b.h || 720, minWidth: 480, minHeight: 360, frame: false, backgroundColor: "#0b0b0f", show: false, title: name + " · Sothis",
    icon: path.join(__dirname, "icon.png"),
    webPreferences: { preload: path.join(__dirname, "azahar-preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true }
  }, okPos ? { x: b.x, y: b.y } : {}));
  w.loadFile(path.join(__dirname, "azahar-host.html"), { query: { name } });
  emuGame = { name: "Retro: " + name + " (3DS)", img: "" }; dcGamePoll();
  w.once("ready-to-show", () => {
    if (w.isDestroyed()) return;
    w.show();
    try { azaProc = require("child_process").spawn(exe, [file], { cwd: path.dirname(exe), stdio: "ignore" }); } catch { w.webContents.send("aza:state", "failed"); return; }
    const hb = w.getNativeWindowHandle();
    const hwnd = hb.length >= 8 ? hb.readBigUInt64LE(0).toString() : String(hb.readUInt32LE(0));
    const r = azaRect();
    try {
      azaHelper = require("child_process").spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "azahar-embed.ps1"),
        "-AzPid", String(azaProc.pid), "-Parent", hwnd, "-X", String(r[0]), "-Y", String(r[1]), "-W", String(r[2]), "-H", String(r[3])], { windowsHide: true });
    } catch { w.webContents.send("aza:state", "failed"); return; }
    let buf = "", docked = false;
    azaHelper.stdout.setEncoding("utf8");
    azaHelper.stdout.on("data", d => {
      buf += d; const ls = buf.split(/\r?\n/); buf = ls.pop();
      for (const l of ls) {
        if (l.startsWith("embedded")) { docked = true; azaMove(); if (!w.isDestroyed()) w.webContents.send("aza:state", "embedded"); }
        else if (l.trim() === "gone") { azaClosing = true; if (!w.isDestroyed()) { if (!docked) w.webContents.send("aza:state", "failed"); else w.destroy(); } }
      }
    });
    setTimeout(() => { if (!docked && !w.isDestroyed()) w.webContents.send("aza:state", "failed"); }, 40000);
  });
  for (const ev of ["resize", "resized", "maximize", "unmaximize", "enter-full-screen", "leave-full-screen", "restore"]) w.on(ev, () => setTimeout(azaMove, ev === "resize" ? 0 : 60));
  w.on("focus", () => azaSend("focus"));
  w.on("close", e => {
    if (azaClosing || !azaProc || azaProc.exitCode !== null) return;
    e.preventDefault();   // ask Azahar to close first (it may ask to stop the game)
    azaClosing = true; azaSend("close");
    setTimeout(() => { if (!w.isDestroyed()) { azaKill(); w.destroy(); } }, 15000);
  });
  const remember = () => { if (w.isDestroyed() || w.isFullScreen() || w.isMaximized()) return; const r = w.getBounds(); settings.azaWin = { x: r.x, y: r.y, w: r.width, h: r.height }; saveSettings(); };
  w.on("moved", remember); w.on("resized", remember);
  w.on("closed", () => { azaKill(); if (azaWin === w) azaWin = null; emuGame = null; dcGamePoll(); });
}
ipcMain.on("aza:full", e => { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.setFullScreen(!w.isFullScreen()); });
ipcMain.on("aza:min", e => { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.minimize(); });
ipcMain.on("aza:close", e => { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.close(); });
app.on("will-quit", azaKill);

function emuProtocol() {
  const { protocol, net: enet } = require("electron");
  const { pathToFileURL } = require("url");
  const root = path.join(__dirname, "emu");
  const handler = async req => {
    let u; try { u = new URL(req.url); } catch { return new Response("bad", { status: 400 }); }
    let f = "";
    const rp = decodeURIComponent(u.pathname).replace(/^\/+/, "");
    if (u.host === "app" && rp.startsWith("rom/")) {
      f = romTokens.get(rp.split("/")[1]) || "";   // your game file (same address as the player, so it can read it)
    } else if (u.host === "app") {
      f = path.normalize(path.join(root, decodeURIComponent(u.pathname).replace(/^\/+/, "")));
      if (!f.startsWith(root + path.sep)) return new Response("no", { status: 403 });
    }
    if (!f || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return new Response("not found", { status: 404 });
    return enet.fetch(pathToFileURL(f).toString());
  };
  protocol.handle("sothisemu", handler);
  // games keep their saves in their own storage, shared by the in-app player and the pop-out window
  try { session.fromPartition("persist:emu").protocol.handle("sothisemu", handler); } catch {}
}

/* ---------- Retro save backup: each game's save file and resume spot are copied to a folder you pick
   (Dropbox by default), so they survive a reinstall or a broken drive. Brought back automatically if missing. ---------- */
const rsDefaultDir = () => {
  const h = app.getPath("home"), dbx = path.join(h, "Dropbox");
  return path.join(fs.existsSync(dbx) ? dbx : app.getPath("documents"), "Sothis Retro Saves");
};
const rsDir = () => (settings.retroSync && typeof settings.retroSync.dir === "string" && settings.retroSync.dir) || rsDefaultDir();
const rsOn = () => !settings.retroSync || settings.retroSync.on !== false;
const rsSafe = s => String(s || "game").replace(/[<>:"/\\|?*\x00-\x1f]+/g, "_").replace(/[. ]+$/, "").slice(0, 120) || "game";
const rsHash = b => require("crypto").createHash("sha1").update(b).digest("hex");
const rsSeen = new Map();   // game -> last hashes written this run
let rsLast = 0, rsErr = "";
function rsEmuContents() {
  let ses = null; try { ses = session.fromPartition("persist:emu"); } catch { return []; }
  return require("electron").webContents.getAllWebContents().filter(w => { try { return !w.isDestroyed() && w.session === ses && /^sothisemu:\/\/app\/emu\.html/i.test(w.getURL()); } catch { return false; } });
}
function rsWrite(f, buf) { fs.mkdirSync(path.dirname(f), { recursive: true }); const t = f + ".tmp"; fs.writeFileSync(t, buf); fs.renameSync(t, f); }
async function rsBackupOne(wc) {
  let d = null;
  try { d = await Promise.race([wc.executeJavaScript("window.sothisExport ? window.sothisExport() : null"), new Promise(r => setTimeout(() => r(null), 6000))]); } catch { return false; }
  if (!d || !d.core || !d.name) return false;
  const dir = path.join(rsDir(), rsSafe(d.core)), base = rsSafe(d.name), key = d.core + "|" + d.name;
  const seen = rsSeen.get(key) || {};
  let wrote = false;
  if (d.save) {
    const b = Buffer.from(d.save, "base64"), h = rsHash(b);
    if (h !== seen.save) {
      const f = path.join(dir, base + ".srm");
      try { if (fs.existsSync(f) && rsHash(fs.readFileSync(f)) !== h) {   // keep the last 5 versions too
        const vd = path.join(dir, "older", base), st = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
        fs.mkdirSync(vd, { recursive: true }); fs.copyFileSync(f, path.join(vd, st + ".srm"));
        fs.readdirSync(vd).filter(x => x.endsWith(".srm")).sort().reverse().slice(5).forEach(x => { try { fs.unlinkSync(path.join(vd, x)); } catch {} });
      } } catch {}
      rsWrite(f, b); seen.save = h; wrote = true;
    }
  }
  if (d.state && d.state.data) {
    const b = Buffer.from(d.state.data, "base64"), h = rsHash(b);
    if (h !== seen.state) { rsWrite(path.join(dir, base + ".resume.state"), b); seen.state = h; wrote = true; }
  }
  if (wrote) { try { rsWrite(path.join(dir, base + ".json"), Buffer.from(JSON.stringify({ name: d.name, core: d.core, sys: d.sys || "", at: Date.now(), stateAt: d.state ? d.state.at : null }, null, 1))); } catch {} }
  rsSeen.set(key, seen);
  return true;
}
async function rsBackupAll() {
  if (!rsOn()) return { ok: false, off: true };
  const list = rsEmuContents(); let n = 0;
  try { for (const wc of list) if (await rsBackupOne(wc)) n++; rsErr = ""; if (n) rsLast = Date.now(); }
  catch (e) { rsErr = "Couldn't write to the backup folder."; }
  return { ok: !rsErr, games: n, err: rsErr };
}
// a game just started: if this PC has no save for it but the backup folder does, bring it back
async function rsRestore(wc) {
  if (!rsOn() || !wc || wc.isDestroyed()) return;
  let info = null;
  try { info = await wc.executeJavaScript("window.sothisLocal ? window.sothisLocal() : null"); } catch { return; }
  if (!info || !info.core || !info.name) return;
  const dir = path.join(rsDir(), rsSafe(info.core)), base = rsSafe(info.name);
  const sf = path.join(dir, base + ".srm"), stf = path.join(dir, base + ".resume.state");
  const pay = {};
  try { if (!info.hasSave && fs.existsSync(sf)) pay.save = fs.readFileSync(sf).toString("base64"); } catch {}
  try { if (!info.hasState && fs.existsSync(stf)) pay.state = fs.readFileSync(stf).toString("base64"); } catch {}
  if (!pay.save && !pay.state) return;
  try { await wc.executeJavaScript("window.sothisImport && window.sothisImport(" + JSON.stringify(pay) + ")"); } catch {}
}
// a full copy of the player's storage once a day while no game is open (a safety net behind the per-game files)
function rsFullCopy() {
  if (!rsOn() || rsEmuContents().length) return;
  try {
    const src = path.join(session.fromPartition("persist:emu").getStoragePath() || "", "IndexedDB");
    if (!src || !fs.existsSync(src)) return;
    const root = path.join(rsDir(), "_full copy"), day = new Date().toISOString().slice(0, 10), dst = path.join(root, day);
    if (fs.existsSync(dst)) return;
    fs.mkdirSync(root, { recursive: true });
    fs.cpSync(src, dst, { recursive: true, filter: s => !/LOCK$/i.test(s) });
    fs.readdirSync(root).filter(x => /^\d{4}-\d\d-\d\d$/.test(x)).sort().reverse().slice(3).forEach(x => { try { fs.rmSync(path.join(root, x), { recursive: true, force: true }); } catch {} });
  } catch {}
}
function rsStart() {
  require("electron").app.on("web-contents-created", (_e, wc) => {
    wc.on("did-finish-load", () => {
      try { if (/^sothisemu:\/\/app\/emu\.html/i.test(wc.getURL())) { setTimeout(() => rsRestore(wc), 3500); setTimeout(() => rsRestore(wc), 9000); } } catch {}
    });
  });
  setInterval(() => { if (rsEmuContents().length) rsBackupAll(); }, 90000);
  setTimeout(rsFullCopy, 60000); setInterval(rsFullCopy, 3 * 3600000);
}
ipcMain.handle("retro:sync", (_e, patch) => {
  if (patch && typeof patch === "object") {
    settings.retroSync = Object.assign({}, settings.retroSync || {});
    if ("on" in patch) settings.retroSync.on = !!patch.on;
    saveSettings();
  }
  return { on: rsOn(), dir: rsDir(), last: rsLast, err: rsErr };
});
ipcMain.handle("retro:syncDir", async () => {
  const r = await dialog.showOpenDialog(win, { title: "Where should Sothis back up your retro saves?", defaultPath: rsDir(), properties: ["openDirectory", "createDirectory"] });
  if (r.canceled || !r.filePaths || !r.filePaths[0]) return null;
  settings.retroSync = Object.assign({}, settings.retroSync || {}, { dir: r.filePaths[0] }); saveSettings();
  rsSeen.clear(); rsBackupAll();
  return { on: rsOn(), dir: rsDir(), last: rsLast, err: rsErr };
});
ipcMain.handle("retro:syncOpen", () => { try { fs.mkdirSync(rsDir(), { recursive: true }); shell.openPath(rsDir()); return true; } catch { return false; } });
ipcMain.handle("retro:backupNow", () => rsBackupAll());


/* ---------- Phone remote: a small web app on your home Wi-Fi (open it on your iPhone, add it to the Home Screen).
   Only answers devices on your local network, and only phones you paired with the code shown in Settings. ---------- */
const PH_PORT = 3875;
let phSrv = null, phLastJson = "", phTick = null;
const phClients = new Set(), phTries = new Map();
const phCfg = () => { settings.phone = Object.assign({ on: true, code: "", phones: [] }, settings.phone || {}); if (!/^\d{6}$/.test(settings.phone.code)) { settings.phone.code = String(require("crypto").randomInt(0, 1e6)).padStart(6, "0"); saveSettings(); } return settings.phone; };
const phLocal = ip => { ip = String(ip || "").replace(/^::ffff:/, ""); return /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|fe80:|fd|fc)/i.test(ip); };
function phAddrs() {
  const out = [];
  for (const [name, list] of Object.entries(require("os").networkInterfaces())) {
    if (/vpn|virtual|vethernet|loopback|radmin|hamachi|zerotier|tailscale|wsl|vmware|virtualbox/i.test(name)) continue;
    for (const a of list || []) if (a.family === "IPv4" && !a.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) out.push({ ip: a.address, name });
  }
  out.sort((a, b) => (/^192\.168\./.test(b.ip) - /^192\.168\./.test(a.ip)) || (/wi-?fi|wlan|ethernet/i.test(b.name) - /wi-?fi|wlan|ethernet/i.test(a.name)));
  return out;
}
const phTok = req => { const h = req.headers["authorization"] || ""; if (h.startsWith("Bearer ")) return h.slice(7); try { return new URL(req.url, "http://x").searchParams.get("t") || ""; } catch { return ""; } };
const phOk = t => !!t && phCfg().phones.some(p => p.t === t);
function phState() {
  let clipRec = false; try { clipRec = !!(clipperObj && clipperObj.state().recording); } catch {}
  const ch = dc.channel;
  return {
    pc: require("os").hostname(),
    player: { connected: !!player.connected, playing: !!player.playing, volume: player.volume, title: player.title || "", artist: player.artist || "", art: player.art || "" },
    game: sess ? { name: sess.game, start: sess.start } : (emuGame ? { name: emuGame.name, start: 0 } : null),
    dc: { ok: dc.status === "ok", mute: !!(dc.vs && dc.vs.mute), deaf: !!(dc.vs && dc.vs.deaf),
      channel: ch ? { name: ch.name, guild: ch.guild || "", members: [...ch.members.values()].slice(0, 12).map(m => ({ id: m.id, name: m.name || "", avatar: m.avatar || "", speaking: dc.speaking.has(m.id), mute: !!m.muted, deaf: !!m.deaf, me: !!m.me })) } : null },
    clip: { recording: clipRec }
  };
}
function phSend(res, ev, data) { try { res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`); } catch {} }
function phEvent(ev, data) { for (const c of phClients) phSend(c, ev, data); }
function phPush(force) {
  if (!phClients.size) return;
  const s = phState(), j = JSON.stringify(s);
  if (!force && j === phLastJson) return;
  phLastJson = j; phEvent("state", s);
}
const PH_FILES = { "/": ["phone.html", "text/html; charset=utf-8"], "/manifest.json": ["phone-manifest.json", "application/manifest+json"], "/icon.png": ["icon.png", "image/png"], "/chime.wav": ["queue-chime.wav", "audio/wav"],
  "/fonts/nunito-800.woff2": ["fonts/nunito-800.woff2", "font/woff2"], "/fonts/pirata-one.woff2": ["fonts/pirata-one.woff2", "font/woff2"] };
async function phCmd(cmd, value) {
  if (["playpause", "next", "prev"].includes(cmd)) { remote(cmd); return { ok: true }; }
  if (cmd === "vol") { const v = Math.max(0, Math.min(1, +value || 0)); remote("vol", v); return { ok: true }; }
  if (cmd === "mute" || cmd === "deaf") { if (dc.status !== "ok") return { ok: false, err: "Discord isn't connected on your PC." }; await dcToggle(cmd); return { ok: true }; }
  if (cmd === "clip") { const r = await doClip().catch(() => ({ ok: false })); return r && r.ok !== false ? { ok: true } : { ok: false, err: (r && r.err) || "Couldn't save a clip." }; }
  if (cmd === "show") { try { showWindow(); } catch {} return { ok: true }; }
  if (cmd === "lock") { return new Promise(res => execFile("rundll32.exe", ["user32.dll,LockWorkStation"], { windowsHide: true }, e => res(e ? { ok: false, err: "Couldn't lock the PC." } : { ok: true }))); }
  return { ok: false, err: "Unknown command" };
}
function phStart() {
  if (phSrv || !phCfg().on) return;
  const http = require("http");
  phSrv = http.createServer((req, res) => {
    const ip = req.socket.remoteAddress;
    if (!phLocal(ip)) { res.writeHead(403); return res.end(); }
    let u; try { u = new URL(req.url, "http://x"); } catch { res.writeHead(400); return res.end(); }
    res.setHeader("Cache-Control", "no-store");
    const f = PH_FILES[u.pathname];
    if (req.method === "GET" && f) {
      try { const b = fs.readFileSync(path.join(__dirname, f[0])); res.writeHead(200, { "Content-Type": f[1] }); return res.end(b); } catch { res.writeHead(404); return res.end(); }
    }
    if (u.pathname === "/api/events" && req.method === "GET") {
      if (!phOk(phTok(req))) { res.writeHead(401); return res.end(); }
      res.writeHead(200, { "Content-Type": "text/event-stream", "Connection": "keep-alive" });
      res.write("retry: 2000\n\n");
      phClients.add(res); phSend(res, "state", phState());
      const ka = setInterval(() => { try { res.write(": hi\n\n"); } catch {} }, 20000);
      req.on("close", () => { clearInterval(ka); phClients.delete(res); });
      return;
    }
    if (req.method === "POST" && (u.pathname === "/api/pair" || u.pathname === "/api/cmd")) {
      let body = "";
      req.on("data", c => { body += c; if (body.length > 4000) req.destroy(); });
      req.on("end", async () => {
        let j = {}; try { j = JSON.parse(body || "{}"); } catch {}
        const send = (code, o) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
        if (u.pathname === "/api/pair") {
          const k = String(ip), now = Date.now(), tr = (phTries.get(k) || []).filter(t => now - t < 60000);
          if (tr.length >= 6) return send(429, { ok: false, err: "Too many tries. Wait a minute." });
          tr.push(now); phTries.set(k, tr);
          const cfg = phCfg();
          if (String(j.code || "").replace(/\D/g, "") !== cfg.code) return send(403, { ok: false, err: "That code doesn't match. Check Sothis → Settings → Phone." });
          const t = require("crypto").randomBytes(24).toString("hex");
          const ua = String(req.headers["user-agent"] || "");
          cfg.phones = cfg.phones.concat({ t, id: t.slice(0, 8), name: String(j.name || (/iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android phone" : "Phone")).slice(0, 40), at: now }).slice(-8);
          saveSettings(); phSettingsPush();
          try { if (win && !win.isDestroyed()) win.webContents.send("phone:paired", { name: cfg.phones[cfg.phones.length - 1].name }); } catch {}
          return send(200, { ok: true, t });
        }
        if (!phOk(j.t || phTok(req))) return send(401, { ok: false, err: "This phone isn't paired any more." });
        const r = await phCmd(String(j.cmd || ""), j.value);
        setTimeout(() => phPush(true), 250); setTimeout(() => phPush(), 900);
        return send(200, r);
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  phSrv.on("error", () => { try { phSrv.close(); } catch {} phSrv = null; });
  phSrv.listen(PH_PORT, "0.0.0.0");
  clearInterval(phTick); phTick = setInterval(() => phPush(), 1000);
}
function phStop() { clearInterval(phTick); phTick = null; for (const c of phClients) { try { c.end(); } catch {} } phClients.clear(); try { phSrv && phSrv.close(); } catch {} phSrv = null; }
function phInfo() { const c = phCfg(); return { on: !!c.on, running: !!phSrv, code: c.code, port: PH_PORT, addrs: phAddrs().map(a => a.ip), phones: c.phones.map(p => ({ id: p.id, name: p.name, at: p.at })) }; }
function phSettingsPush() { try { if (win && !win.isDestroyed()) win.webContents.send("phone:info", phInfo()); } catch {} }
ipcMain.handle("phone:get", () => phInfo());
ipcMain.on("personal:get", e => { e.returnValue = { dcServers: Array.isArray(personal.dcServers) ? personal.dcServers.map(String).slice(0, 10) : [], mcAddr: typeof personal.mcAddr === "string" ? personal.mcAddr : "" }; });
ipcMain.handle("phone:set", (_e, on) => { phCfg().on = !!on; saveSettings(); if (on) phStart(); else phStop(); return phInfo(); });
ipcMain.handle("phone:newCode", () => { phCfg().code = ""; saveSettings(); phCfg(); return phInfo(); });
ipcMain.handle("phone:forget", (_e, id) => {
  const c = phCfg(), gone = c.phones.find(p => p.id === id);
  c.phones = c.phones.filter(p => p.id !== id); saveSettings();
  if (gone) phEvent("unpaired", { id });
  return phInfo();
});
app.on("will-quit", phStop);

/* ---------- Retro library: works out which game each file is (checksums against the No-Intro / Redump lists from
   the libretro database), groups original + patched copies, finds exact duplicates, and keeps play time,
   "finished" and your collections. The game lists are downloaded once per system and kept in Roaming\Sothis\retro-db. ---------- */
const LIB_DB = () => path.join(DATA_DIR, "retro-db");
const LIB_RAW = "https://raw.githubusercontent.com/libretro/libretro-database/master/metadat/";
const libDbs = new Map();   // lib -> { crc: Map, title: Map } once loaded
let libCrcCache = null;     // file path -> { size, mtime, crc }
const libCrcFile = () => path.join(LIB_DB(), "file-crc.json");
const libLoadCrc = () => libCrcCache || (libCrcCache = (() => { try { return JSON.parse(fs.readFileSync(libCrcFile(), "utf8")); } catch { return {}; } })());
let libCrcSaveT = null;
const libSaveCrc = () => { clearTimeout(libCrcSaveT); libCrcSaveT = setTimeout(() => { try { fs.mkdirSync(LIB_DB(), { recursive: true }); fs.writeFileSync(libCrcFile(), JSON.stringify(libCrcCache || {})); } catch {} }, 1500); };
const libTitle = n => String(n || "").replace(/\.[a-z0-9]{1,4}$/i, "").replace(/\s*[\(\[][^)\]]*[\)\]]/g, "").replace(/\s+/g, " ").trim();
const libNorm = n => libTitle(n).toLowerCase().replace(/^the\s+|,\s*the\b/g, "").replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
const libPatched = n => /\((patched|hack|t[\s+-]?en[^)]*|translat[^)]*|t\+?eng|beta patch)\)|\[(t|h)[^\]]*\]/i.test(n);
async function libFetchDat(lib, kind) {
  const f = path.join(LIB_DB(), kind + " - " + lib + ".dat");
  try { const st = fs.statSync(f); if (Date.now() - st.mtimeMs < 30 * 86400000 && st.size > 100) return fs.readFileSync(f, "utf8"); } catch {}
  try {
    const r = await fetch(LIB_RAW + kind + "/" + encodeURIComponent(lib) + ".dat");
    if (!r.ok) throw new Error(String(r.status));
    const t = await r.text();
    fs.mkdirSync(LIB_DB(), { recursive: true }); fs.writeFileSync(f, t);
    return t;
  } catch { try { return fs.readFileSync(f, "utf8"); } catch { return ""; } }
}
function libParse(t, field) {
  const out = [];
  const re = /game \(\s*([\s\S]*?)\n\)/g; let m;
  while ((m = re.exec(t))) {
    const b = m[1];
    const name = (/^\s*(?:name|comment) "([^"]*)"/m.exec(b) || [])[1] || "";
    const val = field ? ((new RegExp("^\\s*" + field + ' "([^"]*)"', "m")).exec(b) || [])[1] || "" : "";
    const crcs = [...b.matchAll(/\bcrc ([0-9A-Fa-f]{8})/g)].map(x => x[1].toUpperCase());
    out.push({ name, val, crcs });
  }
  return out;
}
async function libDb(lib) {
  if (libDbs.has(lib)) return libDbs.get(lib);
  const main = lib === "Sony - PlayStation" ? "redump" : "no-intro";
  const [t0, ty, tg, td] = await Promise.all([libFetchDat(lib, main), libFetchDat(lib, "releaseyear"), libFetchDat(lib, "genre"), libFetchDat(lib, "developer")]);
  const crc = new Map(), title = new Map();
  for (const g of libParse(t0)) {
    const e = { name: g.name, region: ((/\(([^)]*(USA|Europe|Japan|World|Korea|Australia)[^)]*)\)/.exec(g.name) || [])[1] || "") };
    for (const c of g.crcs.slice(0, 1)) crc.set(c, e);   // first track / main rom
    const k = libNorm(g.name), cur = title.get(k);
    const rank = x => (/USA|World/.test(x.region) ? 2 : 0) + (/\((Virtual Console|Beta|Proto|Demo|Sample|Kiosk|Rev \d)[^)]*\)/i.test(x.name) ? -3 : 0);
    if (!cur || rank(e) > rank(cur)) title.set(k, e);
  }
  const extra = (t, field, key) => { for (const g of libParse(t, field)) for (const c of g.crcs) { const e = crc.get(c); if (e && g.val) e[key] = g.val; } };
  extra(ty, "releaseyear", "year"); extra(tg, "genre", "genre"); extra(td, "developer", "dev");
  // titles inherit year/genre/developer from their crc twin
  const db = { crc, title, ok: crc.size > 0 };
  libDbs.set(lib, db);
  return db;
}
// checksum of a file: zip files carry it in their index; other files are read once and the result kept
const CRC_T = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crcJs(buf, c = 0) { c = ~c; for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return ~c >>> 0; }
function zipCrc(f) {
  try {
    const fd = fs.openSync(f, "r"), size = fs.fstatSync(fd).size, n = Math.min(size, 65557), b = Buffer.alloc(n);
    fs.readSync(fd, b, 0, n, size - n); fs.closeSync(fd);
    const e = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])); if (e < 0) return null;
    const cdOff = b.readUInt32LE(e + 16), cnt = b.readUInt16LE(e + 10);
    const fd2 = fs.openSync(f, "r"), cdLen = b.readUInt32LE(e + 12), cd = Buffer.alloc(Math.min(cdLen, 4 << 20)); fs.readSync(fd2, cd, 0, cd.length, cdOff); fs.closeSync(fd2);
    let p = 0, best = null;
    for (let i = 0; i < cnt && p + 46 <= cd.length; i++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) break;
      const crc = cd.readUInt32LE(p + 16), usize = cd.readUInt32LE(p + 24), nl = cd.readUInt16LE(p + 28), xl = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32);
      const nm = cd.slice(p + 46, p + 46 + nl).toString("utf8");
      if (!/\/$/.test(nm) && ROM_SYS.some(s => s.re.test(nm)) && (!best || usize > best.size)) best = { crc, size: usize };
      p += 46 + nl + xl + cl;
    }
    return best ? best.crc.toString(16).toUpperCase().padStart(8, "0") : null;
  } catch { return null; }
}
async function fileCrc(f) {
  const c = libLoadCrc(); let st; try { st = fs.statSync(f); } catch { return null; }
  const k = f.toLowerCase(), hit = c[k];
  if (hit && hit.size === st.size && hit.mtime === Math.round(st.mtimeMs)) return hit.crc;
  let crc = null;
  if (/\.zip$/i.test(f)) crc = zipCrc(f);
  else if (!/\.(7z|chd|pbp|rar)$/i.test(f) && st.size <= 1024 * 1048576) {
    const zl = require("zlib");
    crc = await new Promise(res => {
      let v = 0; const s = fs.createReadStream(f, { highWaterMark: 4 << 20 });
      if (!zl.crc32 && st.size > 96 << 20) { s.destroy(); return res(null); }
      s.on("data", d => { v = zl.crc32 ? zl.crc32(d, v) : crcJs(d, v); });
      s.on("end", () => res((v >>> 0).toString(16).toUpperCase().padStart(8, "0"))); s.on("error", () => res(null));
    });
    // NES headers aren't part of the No-Intro checksum: try again without the 16-byte header
    if (crc && /\.nes$/i.test(f) && st.size > 16) { try { const b = fs.readFileSync(f); if (b.slice(0, 4).toString("latin1") === "NES\x1a") c[k + "|nh"] = crcJs(b.slice(16)).toString(16).toUpperCase().padStart(8, "0"); } catch {} }
  }
  c[k] = { size: st.size, mtime: Math.round(st.mtimeMs), crc }; libSaveCrc();
  return crc;
}
let libBusy = null, libLast = null;
const libKeyOf = new Map();   // token -> group key (for play time)
async function libBuild() {
  const scan = romScan();
  const items = scan.items.filter(x => !x.azahar);
  const out = [];
  let i = 0;
  for (const it of items) {
    i++;
    if (i % 10 === 0) try { if (win && !win.isDestroyed()) win.webContents.send("lib:progress", { done: i, total: items.length }); } catch {}
    const file = romTokens.get(it.token) || "";
    const db = it.lib ? await libDb(it.lib) : { crc: new Map(), title: new Map() };
    let crc = await fileCrc(file), hit = crc ? db.crc.get(crc) : null, how = hit ? "crc" : "";
    if (!hit && crc) { const nh = libLoadCrc()[file.toLowerCase() + "|nh"]; if (nh && db.crc.get(nh)) { hit = db.crc.get(nh); how = "crc"; } }
    const raw = path.basename(file), en = romEn(raw.replace(/\.[^.]+$/, ""));
    if (!hit) { hit = db.title.get(libNorm(en)) || db.title.get(libNorm(raw)) || null; if (hit) how = "name"; }
    // year/genre/developer live on the crc entry of the same title
    let meta = hit || {};
    if (hit && !hit.year) { for (const e of db.crc.values()) if (libNorm(e.name) === libNorm(hit.name) && (e.year || e.genre)) { meta = Object.assign({}, hit, { year: e.year, genre: e.genre, dev: e.dev }); break; } }
    const title = hit ? libTitle(hit.name) : libTitle(en) || en;
    const patched = libPatched(raw) || (how === "name" && /\.(gba|gb|gbc|nes|sfc|smc|nds|n64|z64|md|gen)$/i.test(raw));
    const key = (it.lib || it.sys) + "|" + libNorm(title);
    libKeyOf.set(it.token, key);
    out.push({ token: it.token, file: it.file, path: file, dir: it.dir, size: it.size, sys: it.sys, lib: it.lib, core: it.core, crc: crc || "",
      key, title, official: hit ? hit.name : "", how, region: (hit && hit.region) || ((/\(([^)]*(USA|Europe|Japan|World)[^)]*)\)/.exec(raw) || [])[1] || ""),
      patched, year: meta.year || "", genre: meta.genre || "", dev: meta.dev || "" });
  }
  // duplicates: the same checksum more than once
  const byCrc = new Map();
  for (const x of out) if (x.crc) (byCrc.get(x.crc) || byCrc.set(x.crc, []).get(x.crc)).push(x);
  const dups = [...byCrc.values()].filter(l => l.length > 1).map(l => ({ crc: l[0].crc, title: l[0].title, size: l[0].size, files: l.map(x => x.path) }));
  for (const x of out) x.dup = (byCrc.get(x.crc) || []).length > 1;
  libLast = { at: Date.now(), items: out, dups, dirs: scan.dirs };
  try { if (win && !win.isDestroyed()) win.webContents.send("lib:progress", { done: items.length, total: items.length, finished: true }); } catch {}
  return libLast;
}
function libStats() {
  const s = settings.retroStats && typeof settings.retroStats === "object" ? settings.retroStats : {};
  return { stats: s, cols: Array.isArray(settings.retroCols) ? settings.retroCols : [] };
}
ipcMain.handle("lib:get", async (_e, force) => {
  if (!force && libLast && Date.now() - libLast.at < 5 * 60000) return Object.assign({}, libLast, libStats());
  if (!libBusy) libBusy = libBuild().finally(() => { libBusy = null; });
  try { await libBusy; } catch {}
  return Object.assign({}, libLast || { items: [], dups: [] }, libStats());
});
ipcMain.handle("lib:set", (_e, { key, patch }) => {
  if (!key) return libStats();
  settings.retroStats = settings.retroStats || {};
  const s = settings.retroStats[key] = Object.assign({ time: 0, last: 0, plays: 0, done: false }, settings.retroStats[key] || {});
  if (patch && "done" in patch) s.done = !!patch.done;
  if (patch && typeof patch.prefer === "string") s.prefer = patch.prefer.slice(0, 40);
  saveSettings(); return libStats();
});
ipcMain.handle("lib:cols", (_e, cols) => {
  if (Array.isArray(cols)) settings.retroCols = cols.filter(c => c && typeof c.name === "string").slice(0, 40).map(c => ({ name: c.name.slice(0, 40), keys: (Array.isArray(c.keys) ? c.keys : []).filter(k => typeof k === "string").slice(0, 2000) }));
  saveSettings(); return libStats();
});
// play time: counted while a retro game is open (inside Sothis or in its own window)
let libPlay = null;
function libPlayStart(token) {
  libPlayStop();
  const key = libKeyOf.get(token); if (!key) return;
  libPlay = { key, token, at: Date.now() };
  settings.retroStats = settings.retroStats || {};
  const s = settings.retroStats[key] = Object.assign({ time: 0, last: 0, plays: 0, done: false }, settings.retroStats[key] || {});
  s.plays++; s.last = Date.now(); s.prefer = token; saveSettings();
}
function libPlayStop() {
  if (!libPlay) return;
  const s = (settings.retroStats || {})[libPlay.key];
  if (s) { s.time += Math.max(0, Date.now() - libPlay.at); s.last = Date.now(); saveSettings(); }
  libPlay = null;
}
setInterval(() => { if (libPlay) { const s = (settings.retroStats || {})[libPlay.key]; if (s) { s.time += Date.now() - libPlay.at; s.last = Date.now(); libPlay.at = Date.now(); saveSettings(); } } }, 60000);
ipcMain.on("lib:playing", (_e, token) => { if (token) libPlayStart(String(token)); else libPlayStop(); });
app.on("will-quit", libPlayStop);

/* ---------- Updates: Sothis checks its GitHub releases, downloads the new app files and swaps them in.
   Only the app's own files are replaced; your settings, sign-ins and saves (Roaming\Sothis) are never touched. ---------- */
const PKG = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8")); } catch { return {}; } })();
const APP_VER = String(PKG.version || "0.0.0"), UPD_REPO = /^[\w.-]+\/[\w.-]+$/.test(PKG.updateRepo || "") ? PKG.updateRepo : "";
const verCmp = (a, b) => { const x = String(a).replace(/^v/, "").split(/[.-]/).map(n => parseInt(n, 10) || 0), y = String(b).replace(/^v/, "").split(/[.-]/).map(n => parseInt(n, 10) || 0); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };
let upd = { state: "idle", ver: APP_VER, latest: "", err: "", at: 0, notes: "" }, updBusy = false;
const updSend = () => { try { if (win && !win.isDestroyed()) win.webContents.send("upd:state", upd); } catch {} };
async function updDownload(url, file) {
  const r = await fetch(url, { headers: { "User-Agent": "Sothis/" + APP_VER } });
  if (!r.ok || !r.body) throw new Error("download failed (" + r.status + ")");
  const { Readable } = require("stream"), { pipeline } = require("stream/promises");
  await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(file));
}
// the repo's main branch is the release: its package.json says the newest version, and its zip holds the app files
async function updCheck(manual) {
  if (!UPD_REPO || updBusy) { if (!UPD_REPO) { upd.state = "norepo"; updSend(); } return upd; }
  updBusy = true; upd.state = "checking"; upd.err = ""; updSend();
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${UPD_REPO}/main/package.json?t=${Date.now()}`, { headers: { "User-Agent": "Sothis/" + APP_VER, "Cache-Control": "no-cache" } });
    if (!r.ok) throw new Error(r.status === 404 ? "Nothing published yet." : "GitHub answered " + r.status);
    const pk = await r.json();
    upd.latest = String(pk.version || "").replace(/^v/, ""); upd.at = Date.now();
    if (!upd.latest || verCmp(upd.latest, APP_VER) <= 0) { upd.state = "current"; return upd; }
    if (settings.updDone === upd.latest) { upd.state = "ready"; return upd; }   // already swapped in, waiting for a restart
    upd.state = "downloading"; updSend();
    const dir = path.join(DATA_DIR, "update"); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    const zip = path.join(dir, "app.zip");
    await updDownload(`https://codeload.github.com/${UPD_REPO}/zip/refs/heads/main`, zip);
    upd.state = "installing"; updSend();
    const staged = path.join(dir, "staged");
    await new Promise((res, rej) => execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${staged.replace(/'/g, "''")}' -Force`], { windowsHide: true, timeout: 180000 }, e => e ? rej(new Error("Couldn't unpack the update.")) : res()));
    // GitHub puts everything in one top folder (Sothis-main)
    let root = staged;
    if (!fs.existsSync(path.join(root, "main.js"))) { const sub = fs.readdirSync(staged, { withFileTypes: true }).find(d => d.isDirectory() && fs.existsSync(path.join(staged, d.name, "main.js"))); if (sub) root = path.join(staged, sub.name); }
    let pkNew = {}; try { pkNew = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")); } catch {}
    if (!fs.existsSync(path.join(root, "main.js")) || verCmp(pkNew.version || "0", APP_VER) <= 0) throw new Error("The update looks incomplete.");
    const skip = new Set(["installer", ".gitignore", "README.md", ".github"]);
    for (const e of fs.readdirSync(root)) if (!skip.has(e)) fs.cpSync(path.join(root, e), path.join(__dirname, e), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
    settings.updDone = upd.latest; saveSettings();
    upd.state = "ready";
    try { if (win && !win.isDestroyed()) win.webContents.send("app:update", { restart: true }); } catch {}
  } catch (e) { upd.state = "error"; upd.err = String((e && e.message) || e).slice(0, 160); }
  finally { updBusy = false; updSend(); }
  return upd;
}
ipcMain.handle("upd:get", () => Object.assign({}, upd, { repo: UPD_REPO, auto: settings.updAuto !== false }));
ipcMain.handle("upd:check", () => updCheck(true));
ipcMain.handle("upd:auto", (_e, on) => { settings.updAuto = !!on; saveSettings(); return settings.updAuto; });
function updStart() {
  if (settings.updDone && verCmp(settings.updDone, APP_VER) <= 0) { delete settings.updDone; saveSettings(); }   // the update is running now
  setTimeout(() => { if (settings.updAuto !== false) updCheck(); }, 45000);
  setInterval(() => { if (settings.updAuto !== false) updCheck(); }, 3 * 3600000);
}

function extrasStart() {
  emuProtocol();
  updStart();
  phStart();
  try { fs.rmSync(path.join(__dirname, "pc-health.ps1"), { force: true }); } catch {}   // leftover from the removed PC health chip
  rsStart();
  setTimeout(trkPoll, 5000);
  setInterval(trkPoll, 15000);
  setTimeout(duckRestore, 8000);
}
app.on("will-quit", () => { try { qpProc && qpProc.kill(); } catch {} });

/* ---------- Watch: streaming services. Netflix, Prime Video, Hulu and Crunchyroll need protected video (Widevine),
   which Sothis's engine doesn't have, so they open in a clean Microsoft Edge window. YouTube and Twitch play in Sothis. ---------- */
const WATCH = {
  netflix: { name: "Netflix", url: "https://www.netflix.com/browse", edge: true, title: "Netflix" },
  prime: { name: "Prime Video", url: "https://www.primevideo.com/", edge: true, title: "Prime Video" },
  hulu: { name: "Hulu", url: "https://www.hulu.com/hub/home", edge: true, title: "Hulu" },
  crunchyroll: { name: "Crunchyroll", url: "https://www.crunchyroll.com/", edge: true, title: "Crunchyroll" },
  youtube: { name: "YouTube", url: "https://www.youtube.com/", partition: "persist:ytm" },
  twitch: { name: "Twitch", url: "https://www.twitch.tv/", edge: true, title: "Twitch" }
};
const watchTop = () => !!settings.watchTop;
const watchWins = {};
// Your own Chrome first (already signed in to everything), then Edge
function edgeExe() {
  const PF = process.env.ProgramFiles || "C:\\Program Files", PF86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", L = process.env.LOCALAPPDATA || "";
  return [path.join(PF, "Google", "Chrome", "Application", "chrome.exe"), path.join(PF86, "Google", "Chrome", "Application", "chrome.exe"), path.join(L, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(PF86, "Microsoft", "Edge", "Application", "msedge.exe"), path.join(PF, "Microsoft", "Edge", "Application", "msedge.exe")]
    .find(p => { try { return fs.existsSync(p); } catch { return false; } }) || "";
}
function watchTopApply(on, tries = 0) {
  if (process.platform !== "win32") return;
  const match = Object.values(WATCH).filter(w => w.edge).map(w => w.title).join("|");
  execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "watch-top.ps1"), "-Match", match, "-On", on ? "1" : "0"],
    { windowsHide: true, timeout: 15000 }, (_err, out) => {
      // a window that's still opening gets caught on the next try
      if (on && tries < 6 && !(parseInt(String(out).trim(), 10) > 0)) setTimeout(() => watchTopApply(on, tries + 1), 2500);
    });
  for (const w of Object.values(watchWins)) if (w && !w.isDestroyed()) w.setAlwaysOnTop(on, "floating");
}
function watchOpenSothis(key, w) {
  const old = watchWins[key];
  if (old && !old.isDestroyed()) { old.show(); old.focus(); return true; }
  const b = (settings.watchPos || {})[key] || {};
  const okPos = typeof b.x === "number" && screen.getAllDisplays().some(d => b.x >= d.workArea.x - 50 && b.x < d.workArea.x + d.workArea.width && b.y >= d.workArea.y - 20 && b.y < d.workArea.y + d.workArea.height);
  const bw = new BrowserWindow(Object.assign({
    width: b.w || 1100, height: b.h || 680, minWidth: 360, minHeight: 220, backgroundColor: "#0b0b0f", title: w.name, autoHideMenuBar: true,
    icon: path.join(__dirname, "icon.png"), alwaysOnTop: watchTop(),
    webPreferences: { partition: w.partition, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
  }, okPos ? { x: b.x, y: b.y } : {}));
  if (watchTop()) bw.setAlwaysOnTop(true, "floating");
  bw.setMenuBarVisibility(false);
  bw.webContents.setWindowOpenHandler(({ url }) => {
    try { const h = new URL(url).hostname; if (/(^|\.)(youtube\.com|twitch\.tv|google\.com|youtu\.be)$/.test(h)) { bw.loadURL(url); return { action: "deny" }; } } catch {}
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  bw.webContents.on("page-title-updated", (_e, t) => { try { bw.setTitle(t + " · Sothis"); } catch {} });
  bw.loadURL(w.url);
  const remember = () => { if (bw.isDestroyed() || bw.isFullScreen() || bw.isMaximized()) return; const r = bw.getBounds(); settings.watchPos = Object.assign({}, settings.watchPos, { [key]: { x: r.x, y: r.y, w: r.width, h: r.height } }); saveSettings(); };
  bw.on("moved", remember); bw.on("resized", remember);
  bw.on("closed", () => { if (watchWins[key] === bw) delete watchWins[key]; });
  watchWins[key] = bw;
  return true;
}
ipcMain.handle("watch:open", (_e, key) => {
  const w = WATCH[key]; if (!w) return { ok: false };
  if (!w.edge) return { ok: watchOpenSothis(key, w) };
  const exe = edgeExe();
  if (!exe) { shell.openExternal(w.url); return { ok: true, browser: true }; }
  try {
    const chrome = /chrome\.exe$/i.test(exe);
    // Chrome: your normal profile, so you're already signed in. Edge: a separate profile just for Sothis.
    const args = chrome ? [`--app=${w.url}`] : [`--app=${w.url}`, `--user-data-dir=${path.join(DATA_DIR, "watch-browser")}`, "--no-first-run", "--no-default-browser-check", "--window-size=1100,680"];
    require("child_process").spawn(exe, args, { detached: true, stdio: "ignore" }).unref();
    if (watchTop()) setTimeout(() => watchTopApply(true), 2500);
    return { ok: true, chrome };
  } catch { shell.openExternal(w.url); return { ok: true, browser: true }; }
});
ipcMain.handle("watch:top", (_e, on) => {
  if (typeof on === "boolean") { settings.watchTop = on; saveSettings(); watchTopApply(on); }
  return watchTop();
});


/* ---------- Files: your downloaded music (MP3) and videos (MP4), plus a downloader for links ---------- */
const inDirs = (f, dirs) => { const r = path.resolve(String(f || "")); return dirs.some(d => d && r.startsWith(path.resolve(d) + path.sep)); };
const AUD_RE = /\.(mp3|m4a|opus|ogg|wav|flac|aac)$/i;
function dlDir(kind) {
  const saved = kind === "mp3" ? settings.mp3Dir : settings.mp4Dir;
  if (saved && fs.existsSync(saved)) return saved;
  const d = path.join(app.getPath(kind === "mp3" ? "music" : "videos"), "Sothis Downloads");
  try { fs.mkdirSync(d, { recursive: true }); } catch {}
  return d;
}
// Photos: a folder Sothis keeps your pictures in (Pictures\\Sothis Photos unless you pick another)
const IMG_RE = /\.(png|jpe?g|gif|webp|bmp|avif)$/i;
function photosDir() {
  if (settings.photoDir && fs.existsSync(settings.photoDir)) return settings.photoDir;
  const d = path.join(app.getPath("pictures"), "Sothis Photos");
  try { fs.mkdirSync(d, { recursive: true }); } catch {}
  return d;
}
const SOTHIS_DIRS = () => [clipsDir(), dlDir("mp4"), dlDir("mp3"), photosDir(), ...romDirs()];
function photoCopy(list) {
  const dir = photosDir(); let added = 0, skipped = 0;
  for (const src of (Array.isArray(list) ? list : []).slice(0, 500)) {
    try {
      if (typeof src !== "string" || !IMG_RE.test(src) || !fs.statSync(src).isFile()) { skipped++; continue; }
      if (inDirs(src, [dir])) { skipped++; continue; }
      const ext = path.extname(src), base = path.basename(src, ext);
      let dest = path.join(dir, base + ext), n = 2;
      while (fs.existsSync(dest)) dest = path.join(dir, `${base} (${n++})${ext}`);
      fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL); added++;
    } catch { skipped++; }
  }
  return { ok: true, added, skipped };
}
ipcMain.handle("photos:add", async () => {
  const r = await dialog.showOpenDialog(win, { title: "Add photos to Sothis", properties: ["openFile", "multiSelections"], filters: [{ name: "Pictures", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif"] }] });
  if (r.canceled || !r.filePaths || !r.filePaths.length) return { ok: false, added: 0 };
  return photoCopy(r.filePaths);
});
ipcMain.handle("photos:addPaths", (_e, list) => photoCopy(list));
ipcMain.handle("files:list", (_e, kind) => {
  if (kind !== "mp3" && kind !== "mp4" && kind !== "photos") return null;
  const dir = kind === "photos" ? photosDir() : dlDir(kind), re = kind === "mp3" ? AUD_RE : kind === "photos" ? IMG_RE : VID_RE, items = [];
  const walk = (d, depth) => {
    let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { if (depth < 2 && !/^\./.test(e.name)) walk(f, depth + 1); continue; }
      if (!re.test(e.name) || /\.part$/i.test(e.name)) continue;
      try { const st = fs.statSync(f); items.push({ name: e.name.replace(/\.[^.]+$/, "").replace(/\s*\[[\w-]{6,}\]$/, ""), path: f, url: require("url").pathToFileURL(f).href, size: st.size, at: st.mtimeMs, ext: path.extname(f).slice(1).toLowerCase() }); } catch {}
    }
  };
  walk(dir, 0);
  items.sort((a, b) => b.at - a.at);
  return { dir, exists: true, items: items.slice(0, 500) };
});
ipcMain.handle("files:delete", async (_e, f) => {
  if (typeof f !== "string" || !fs.existsSync(f) || !inDirs(f, SOTHIS_DIRS())) return { ok: false, err: "Sothis can only delete files in your Sothis folders." };
  try { await shell.trashItem(f); return { ok: true }; } catch (e) { return { ok: false, err: String(e.message || e) }; }
});
ipcMain.handle("files:open", async (_e, kind) => {
  const dir = kind === "clips" ? clipsDir() : kind === "roms" ? (romDirs()[0] || "") : kind === "photos" ? photosDir() : dlDir(kind);
  if (!dir) return false;
  return !(await shell.openPath(dir));
});
ipcMain.handle("files:choose", async (_e, kind) => {
  if (kind === "photos") {
    const r = await dialog.showOpenDialog(win, { title: "Where should photos live?", defaultPath: photosDir(), properties: ["openDirectory", "createDirectory"] });
    if (!r.canceled && r.filePaths && r.filePaths[0]) { settings.photoDir = r.filePaths[0]; saveSettings(); }
    return photosDir();
  }
  if (kind !== "mp3" && kind !== "mp4") return null;
  const r = await dialog.showOpenDialog(win, { title: kind === "mp3" ? "Where should music go?" : "Where should videos go?", defaultPath: dlDir(kind), properties: ["openDirectory", "createDirectory"] });
  if (!r.canceled && r.filePaths && r.filePaths[0]) { if (kind === "mp3") settings.mp3Dir = r.filePaths[0]; else settings.mp4Dir = r.filePaths[0]; saveSettings(); }
  return dlDir(kind);
});

// Downloader: yt-dlp (fetched once from its official GitHub release) + the ffmpeg that comes with Medal
const DL_TOOLS = path.join(DATA_DIR, "tools");
const ytdlpPath = () => path.join(DL_TOOLS, "yt-dlp.exe");
let dlQueue = [], dlCur = null, dlSeq = 0, dlSetup = null;
const dlSend = (d) => { if (win && !win.isDestroyed()) win.webContents.send("dl:update", d); };
async function ytdlpEnsure(job) {
  if (fs.existsSync(ytdlpPath()) && fs.statSync(ytdlpPath()).size > 1e6) return true;
  if (!dlSetup) dlSetup = (async () => {
    try {
      fs.mkdirSync(DL_TOOLS, { recursive: true });
      const { net: enet } = require("electron");
      const r = await enet.fetch("https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe");
      if (!r.ok) return false;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 1e6 || buf[0] !== 0x4d || buf[1] !== 0x5a) return false;   // must be a Windows program
      const tmp = ytdlpPath() + ".tmp"; fs.writeFileSync(tmp, buf); fs.renameSync(tmp, ytdlpPath());
      return true;
    } catch { return false; } finally { dlSetup = null; }
  })();
  dlSend({ id: job.id, state: "setup", title: job.title });
  return await dlSetup;
}
function dlNext() {
  if (dlCur || !dlQueue.length) return;
  dlCur = dlQueue.shift();
  dlRun(dlCur).catch(() => {}).finally(() => { dlCur = null; dlNext(); });
}
async function dlRun(job) {
  if (!(await ytdlpEnsure(job))) { dlSend({ id: job.id, state: "error", err: "Couldn't set up the downloader. Check your internet and try again." }); return; }
  if (job.cancelled) return;
  const tools = medalTools();
  const dir = dlDir(job.fmt);
  const args = ["--no-playlist", "--newline", "--progress", "--no-colors", "--windows-filenames", "--no-mtime", "-P", dir, "-o", "%(title).150B [%(id)s].%(ext)s",
    "--progress-template", "download:SOTHIS|%(progress._percent_str)s|%(progress._eta_str)s|%(info.title)s", "--print", "after_move:SOTHISFILE|%(filepath)s"];
  if (tools && tools.ffmpeg) args.push("--ffmpeg-location", tools.ffmpeg);
  if (job.fmt === "mp3") {
    if (tools && tools.ffmpeg) args.push("-x", "--audio-format", "mp3", "--audio-quality", "0", "--embed-metadata", "--embed-thumbnail");
    else args.push("-f", "ba[ext=m4a]/ba");   // no ffmpeg: keep the original audio file
  } else {
    if (tools && tools.ffmpeg) args.push("-f", "bv*[ext=mp4][vcodec^=avc1]+ba[ext=m4a]/bv*[ext=mp4]+ba/b[ext=mp4]/bv*+ba/b", "--merge-output-format", "mp4", "--embed-metadata");
    else args.push("-f", "b[ext=mp4]/b");
  }
  args.push("--", job.url);
  dlSend({ id: job.id, state: "running", pct: 0, title: job.title });
  await new Promise(resolve => {
    let p; try { p = require("child_process").spawn(ytdlpPath(), args, { windowsHide: true }); } catch (e) { dlSend({ id: job.id, state: "error", err: "Couldn't start the downloader." }); return resolve(); }
    job.proc = p;
    let out = "", err = "", file = "";
    const onLine = line => {
      const m = line.match(/^SOTHIS\|\s*([\d.]+)%\|([^|]*)\|(.*)$/);
      if (m) { job.title = m[3] || job.title; const pct = Math.min(100, parseFloat(m[1]) || 0); dlSend({ id: job.id, state: pct >= 100 ? "finishing" : "running", pct, eta: m[2].trim(), title: job.title, fmt: job.fmt }); return; }
      const f = line.match(/^SOTHISFILE\|(.+)$/); if (f) file = f[1].trim();
      if (/\[(ExtractAudio|Merger|EmbedThumbnail|Metadata)\]/.test(line)) dlSend({ id: job.id, state: "finishing", title: job.title });
    };
    p.stdout.setEncoding("utf8");
    p.stdout.on("data", d => { out += d; const ls = out.split(/\r?\n/); out = ls.pop(); ls.forEach(onLine); });
    let eb = "";   // with --print, yt-dlp writes its progress to stderr
    p.stderr.setEncoding("utf8");
    p.stderr.on("data", d => { err = (err + d).slice(-2000); eb += d; const ls = eb.split(/\r?\n/); eb = ls.pop(); ls.forEach(onLine); });
    p.on("error", () => { dlSend({ id: job.id, state: "error", err: "Couldn't start the downloader." }); resolve(); });
    p.on("close", code => {
      if (out) onLine(out);
      if (job.cancelled) dlSend({ id: job.id, state: "cancelled", title: job.title });
      else if (code === 0) dlSend({ id: job.id, state: "done", title: job.title, file, fmt: job.fmt });
      else {
        const m = err.match(/ERROR:\s*(.+)/);
        let why = m ? m[1].replace(/\[[^\]]+\]\s*[\w-]+:\s*/, "").slice(0, 160) : "The download didn't finish.";
        if (/Unsupported URL/i.test(err)) why = "That link isn't supported.";
        else if (/Private video|Sign in to confirm|login required/i.test(err)) why = "That video needs a sign-in, so it can't be downloaded.";
        dlSend({ id: job.id, state: "error", err: why, title: job.title });
      }
      resolve();
    });
  });
}
ipcMain.handle("dl:start", (_e, { url, fmt }) => {
  url = String(url || "").trim();
  if (!/^https?:\/\/\S+$/i.test(url)) return { ok: false, err: "Paste a full link that starts with https://" };
  const job = { id: ++dlSeq, url, fmt: fmt === "mp3" ? "mp3" : "mp4", title: url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60) };
  dlQueue.push(job);
  dlSend({ id: job.id, state: "queued", title: job.title, fmt: job.fmt });
  dlNext();
  return { ok: true, id: job.id };
});
ipcMain.handle("dl:cancel", (_e, id) => {
  const q = dlQueue.findIndex(j => j.id === id);
  if (q >= 0) { const j = dlQueue.splice(q, 1)[0]; dlSend({ id: j.id, state: "cancelled", title: j.title }); return true; }
  if (dlCur && dlCur.id === id) { dlCur.cancelled = true; try { dlCur.proc && dlCur.proc.kill(); } catch {} return true; }
  return false;
});
app.on("will-quit", () => { try { dlCur && dlCur.proc && dlCur.proc.kill(); } catch {} });


/* ---------- Retro box art: finds the right cover on the Libretro thumbnail server even when file names are messy ---------- */
// Box art matcher: turns messy file names into the closest No-Intro name on the Libretro thumbnail server
const artKey = n => String(n).toLowerCase()
  .replace(/\.(png|gba|gbc|gb|nes|sfc|smc|nds|z64|n64|v64|md|gen|smd|sms|gg|chd|cue|pbp|zip|7z)$/i, "")
  .replace(/\s*[\(\[][^\)\]]*[\)\]]/g, " ")          // (USA) [!] (Rev 1)
  .replace(/[_&]/g, " ").replace(/\band\b/g, " ")
  .replace(/\bpok[eé]mon\b/g, "pokemon")
  .replace(/^(.*?),\s*the\b/, "the $1")              // "Legend of Zelda, The - X" -> "the legend of zelda - x"
  .replace(/\bthe\b/g, " ")
  .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const tags = n => (String(n).match(/[\(\[][^\)\]]*[\)\]]/g) || []).join(" ").toLowerCase();
function score(cand) {
  const t = tags(cand); let s = 0;
  if (/\busa\b/.test(t)) s += 30; else if (/\bworld\b/.test(t)) s += 25; else if (/\beurope\b/.test(t)) s += 20;
  if (/virtual console|kiosk|demo|beta|proto|hack|alternate|promo|sample/.test(t)) s -= 40;
  if (/\brev\b/.test(t)) s -= 2;
  return s - cand.length / 100;
}
function artPick(list, file) {
  const base = String(file).replace(/\.[a-z0-9]+$/i, "").replace(/[&*/:`<>?\\|"]/g, "_");
  if (list.includes(base + ".png")) return base + ".png";
  const k = artKey(file); if (!k) return "";
  let best = "", bs = -1e9;
  for (const c of list) if (artKey(c) === k) { const s = score(c); if (s > bs) { bs = s; best = c; } }
  if (best) return best;
  // looser: every word of your file name appears in the art name
  const words = k.split(" ").filter(w => w.length > 1);
  if (words.length < 2) return "";
  for (const c of list) { const ck = " " + artKey(c) + " "; if (words.every(w => ck.includes(" " + w + " "))) { const s = score(c) - Math.abs(ck.length - k.length) / 4; if (s > bs) { bs = s; best = c; } } }
  return best;
}
const ART_DIR = path.join(DATA_DIR, "art");
const artLists = {}, artPicks = (() => { try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, "art", "picks.json"), "utf8")); } catch { return {}; } })();
let artSaveT = null;
const artSave = () => { clearTimeout(artSaveT); artSaveT = setTimeout(() => { try { fs.mkdirSync(ART_DIR, { recursive: true }); fs.writeFileSync(path.join(ART_DIR, "picks.json"), JSON.stringify(artPicks)); } catch {} }, 1500); };
function artList(lib) {
  if (artLists[lib]) return artLists[lib];
  const file = path.join(ART_DIR, lib.replace(/[^\w -]/g, "_") + ".json");
  artLists[lib] = (async () => {
    try { const st = fs.statSync(file); if (Date.now() - st.mtimeMs < 14 * 86400000) return JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
    try {
      const { net: enet } = require("electron");
      const r = await enet.fetch(`https://thumbnails.libretro.com/${encodeURIComponent(lib)}/Named_Boxarts/`);
      if (!r.ok) throw new Error("http " + r.status);
      const html = await r.text();
      const names = [...html.matchAll(/href="([^"?\/][^"]*\.png)"/gi)].map(x => { try { return decodeURIComponent(x[1]); } catch { return ""; } }).filter(Boolean);
      if (names.length) { fs.mkdirSync(ART_DIR, { recursive: true }); fs.writeFileSync(file, JSON.stringify(names)); }
      return names;
    } catch { artLists[lib] = null; try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return []; } }
  })();
  return artLists[lib];
}
ipcMain.handle("emu:art", async (_e, token) => {
  const f = romTokens.get(String(token || "")); if (!f) return "";
  const sys = ROM_SYS.find(x => x.re.test(f)) || null;
  let lib = sys && sys.lib;
  if (!lib) { const it = (romScan().items || []).find(x => x.token === token); lib = it && it.lib; }
  if (!lib) return "";
  const name = path.basename(f), en = ROM_EN.find(x => x.re.test(name)), key = lib + "|" + name.toLowerCase() + (en ? "|en" : "");
  if (artPicks[key] !== undefined) return artPicks[key];
  const list = await artList(lib);
  if (!list || !list.length) return "";
  const pick = en && list.includes(en.art) ? en.art : artPick(list, en ? en.art : name);
  const url = pick ? `https://thumbnails.libretro.com/${encodeURIComponent(lib)}/Named_Boxarts/${encodeURIComponent(pick)}` : "";
  artPicks[key] = url; artSave();
  return url;
});


/* ---------- Cheats: ready-made cheat lists from the libretro cheat database, fetched per game ---------- */
let chtIndex = null;
const chtIdx = () => chtIndex || (chtIndex = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, "emu", "cht-index.json"), "utf8")); } catch { return {}; } })());
ipcMain.handle("cheat:find", (_e, token) => {
  const f = romTokens.get(String(token || "")); if (!f) return [];
  const it = (romScan().items || []).find(x => x.token === token);
  const lib = it && it.lib; if (!lib) return [];
  const libs = /Game Boy( Color)?$/.test(lib) ? [lib, lib.endsWith("Color") ? "Nintendo - Game Boy" : "Nintendo - Game Boy Color"] : [lib];
  const k = artKey(path.basename(f)), words = k.split(" ").filter(w => w.length > 1);
  const out = [];
  for (const L of libs) {
    const list = chtIdx()[L] || [];
    let hits = list.filter(n => artKey(n) === k);
    if (!hits.length && words.length >= 2) hits = list.filter(n => {
      // close names only, so "Fire Emblem" never picks up "Fire Emblem - The Sacred Stones"
      const cw = artKey(n).split(" ").filter(w => w.length > 1), cs = new Set(cw), fs2 = new Set(words);
      const common = words.filter(w => cs.has(w)).length, jac = common / new Set([...cw, ...words]).size;
      return (common === words.length && jac >= 0.6) || (cw.length >= 2 && cw.every(w => fs2.has(w)));
    });
    hits.sort((a, b) => score(b) - score(a)).slice(0, 6).forEach(n => out.push({ lib: L, name: n }));
    if (out.length) break;
  }
  return out;
});
ipcMain.handle("cheat:get", async (_e, { lib, name } = {}) => {
  if (!(chtIdx()[lib] || []).includes(name)) return { ok: false, err: "Not in the cheat list." };
  try {
    const { net: enet } = require("electron");
    const r = await enet.fetch(`https://raw.githubusercontent.com/libretro/libretro-database/master/cht/${encodeURIComponent(lib)}/${encodeURIComponent(name)}.cht`);
    if (!r.ok) return { ok: false, err: "Couldn't download the cheats (" + r.status + ")." };
    const txt = await r.text(), d = {}, c = {};
    for (const m of txt.matchAll(/^cheat(\d+)_(desc|code)\s*=\s*"(.*)"\s*$/gm)) (m[2] === "desc" ? d : c)[m[1]] = m[3];
    const list = Object.keys(c).sort((a, b) => a - b).map(i => ({ desc: (d[i] || "Cheat " + (+i + 1)).trim(), code: c[i].trim() })).filter(x => x.code);
    return { ok: true, list };
  } catch { return { ok: false, err: "Couldn't download the cheats. Check your internet." }; }
});
