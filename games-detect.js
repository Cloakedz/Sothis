// Works out whether a program is a game, and which one, so Sothis doesn't need a hand-written list.
// It looks, in order, at: games you marked yourself, the built-in list, your Steam and Epic libraries (by install
// folder), the folders game launchers install into, and Discord's public list of game programs.
"use strict";
const fs = require("fs"), path = require("path");

const norm = p => String(p || "").replace(/\//g, "\\").toLowerCase();
const baseOf = p => { const s = norm(p); return s.slice(s.lastIndexOf("\\") + 1); };

// folders launchers install games into: the folder right after is the game's own
const LAUNCHER_DIR = /\\(steamapps\\common|epic games|riot games|ubisoft game launcher\\games|ea games|origin games|xboxgames|gog galaxy\\games|gog games|rockstar games|amazon games\\library|itch\\apps|games)\\([^\\]+)\\/i;
// things that live in those folders but aren't games
const NOT_GAME_DIR = /^(riot client|steamworks shared|steamvr|steam controller configs|epic online services|launcher|directxredist|redistributables?|_commonredist|battle\.net|ubisoft connect|ea app|ea desktop|origin|rockstar games launcher|social club|wallpaper_engine|content|tools?|mods?|launchers?|installers?|emulators?)$/i;
// launchers, helpers, crash reporters, anti-cheat, installers
const NOT_GAME_EXE = /^(steam|steamwebhelper|steamservice|steamerrorreporter|gameoverlayui|epicgameslauncher|epicwebhelper|eossdk.*|riotclient.*|battle\.net|agent|upc|ubisoftconnect|ubisoftgamelauncher|uplaywebcore|eadesktop|ealauncher|eabackgroundservice|origin|galaxyclient.*|rockstarlauncher|rockstarservice|launcherpatcher|unitycrashhandler(64|32)?|crashreportclient|crashpad_handler|crashhandler|bugsplat.*|easyanticheat.*|eac_?launcher|beservice.*|battleye.*|vgc|vgtray|vanguard.*|cefsharp.*|cef.*process|qtwebengineprocess|.*webhelper|.*_setup|setup|unins\d*|uninstall.*|vc_?redist.*|dxsetup|dotnet.*|notification_helper|msedgewebview2|werfault|redlauncher|bethesdanetlauncher|bootstrapper.*|installer.*|updater?|.*updater|.*crashreporter)\.exe$/i;
// everyday programs that are never the game, wherever they're installed and whatever a list says
const NEVER_EXE = /^(chrome|msedge|firefox|opera|opera_gx|brave|vivaldi|blackwall|sothis|electron|discord|discordptb|discordcanary|obs64|obs32|explorer|code|notepad|notepad\+\+|spotify|vlc|mpv|mpc-hc64|wmplayer|photos|powershell|pwsh|cmd|conhost|windowsterminal|taskmgr|searchhost|shellexperiencehost|applicationframehost|textinputhost|lockapp|dwm|csrss|svchost|rundll32|msiexec|claude|slack|teams|ms-teams|zoom|telegram|whatsapp|steamcmd|modorganizer|vortex|cheatengine.*|medal|medalencoder|nvcontainer|nvidia.*|geforce.*|radeonsoftware|amd.*|armourycrate.*|icue|lghub|razer.*|msiafterburner|rtss|hwinfo64|7zfm|winrar|wallpaper(32|64)|java|javaw|python|pythonw|node)\.exe$/i;
// names too vague to trust from a list on their own
const VAGUE_EXE = /^(game|launcher|start|client|main|play|app|run|engine|win64|win32|x64|bin|default|application|program|shipping|player)\.exe$/i;

function nice(folder) { return String(folder || "").replace(/[_]+/g, " ").replace(/\s+/g, " ").replace(/[®™©]/g, "").trim(); }
function niceExe(exe) {
  let s = String(exe || "").replace(/\.exe$/i, "").replace(/[-_ ]?(win64|win32|x64|x86|64|32)?[-_ ]?(shipping|release|final|dx11|dx12|vulkan|be|eac)?$/i, "");
  s = s.replace(/[_.-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Za-z])(\d)/g, "$1 $2").replace(/\s+/g, " ").trim();
  return s ? s.replace(/\b[a-z]/g, c => c.toUpperCase()) : "";
}

class Detector {
  constructor() { this.dirs = []; this.byExe = new Map(); this.custom = {}; this.notGames = {}; this.builtin = {}; this.listAt = 0; this.scanAt = 0; }
  // builtin: { "cs2.exe": "Counter-Strike 2" }, custom: games you added { exe: name }, notGames: { exe: true }
  setLists({ builtin, custom, notGames }) { if (builtin) this.builtin = builtin; this.custom = custom || {}; this.notGames = notGames || {}; }

  // Read the libraries on this PC. steamRoot: Steam's folder; epicDir: Epic's manifests folder.
  scan({ steamRoot, epicDir } = {}) {
    const dirs = [];
    if (steamRoot) {
      const libs = new Set([path.join(steamRoot, "steamapps")]);
      try { const vdf = fs.readFileSync(path.join(steamRoot, "steamapps", "libraryfolders.vdf"), "utf8"); for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libs.add(path.join(m[1].replace(/\\\\/g, "\\"), "steamapps")); } catch {}
      for (const lib of libs) {
        let files = []; try { files = fs.readdirSync(lib).filter(f => /^appmanifest_\d+\.acf$/.test(f)); } catch { continue; }
        for (const f of files) {
          try {
            const acf = fs.readFileSync(path.join(lib, f), "utf8");
            const sid = (acf.match(/"appid"\s+"(\d+)"/) || [])[1], name = nice((acf.match(/"name"\s+"([^"]+)"/) || [])[1]), dir = (acf.match(/"installdir"\s+"([^"]+)"/) || [])[1];
            if (!sid || !name || !dir || /^(steamworks common redistributables|steam linux runtime|proton)/i.test(name)) continue;
            dirs.push({ dir: norm(path.join(lib, "common", dir)) + "\\", name, sid: +sid, img: `https://cdn.cloudflare.steamstatic.com/steam/apps/${sid}/header.jpg` });
          } catch {}
        }
      }
    }
    if (epicDir) {
      let files = []; try { files = fs.readdirSync(epicDir).filter(f => /\.item$/i.test(f)); } catch {}
      for (const f of files) {
        try {
          const j = JSON.parse(fs.readFileSync(path.join(epicDir, f), "utf8"));
          if (j && j.InstallLocation && j.DisplayName && j.bIsApplication !== false && !/^(ue_|unreal engine)/i.test(j.DisplayName)) dirs.push({ dir: norm(j.InstallLocation).replace(/\\+$/, "") + "\\", name: nice(j.DisplayName), img: "" });
        } catch {}
      }
    }
    dirs.sort((a, b) => b.dir.length - a.dir.length);   // the most specific folder wins
    this.dirs = dirs; this.scanAt = Date.now();
    return dirs.length;
  }
  // more install folders Sothis already knows about (its own Games page): [{ dir, name, img?, sid? }]
  addDirs(list) {
    const have = new Set(this.dirs.map(d => d.dir));
    for (const g of list || []) { if (!g || !g.dir || !g.name) continue; const dir = norm(g.dir).replace(/\\+$/, "") + "\\"; if (dir.length > 4 && !have.has(dir)) { have.add(dir); this.dirs.push({ dir, name: nice(g.name), sid: g.sid || 0, img: g.img || "" }); } }
    this.dirs.sort((a, b) => b.dir.length - a.dir.length);
  }

  // Discord's list of game programs: [{ name, executables: [{ name: "bin/game.exe", os: "win32", is_launcher }] }]
  setDetectable(list) {
    const m = new Map();
    for (const app of Array.isArray(list) ? list : []) {
      if (!app || !app.name || !Array.isArray(app.executables)) continue;
      for (const x of app.executables) {
        if (!x || x.os !== "win32" || x.is_launcher || typeof x.name !== "string") continue;
        const full = norm(x.name.replace(/^>/, "")), base = full.slice(full.lastIndexOf("\\") + 1);
        if (!/\.exe$/.test(base) || NEVER_EXE.test(base) || NOT_GAME_EXE.test(base)) continue;
        const l = m.get(base) || []; if (!l.some(e => e.n === app.name && e.p === full)) l.push({ n: app.name, p: full }); m.set(base, l);
      }
    }
    this.byExe = m; this.listAt = Date.now();
    return m.size;
  }
  // the same list, small enough to keep on disk: { "game.exe": [["Name", "bin\\game.exe"]] }
  packDetectable() { const o = {}; for (const [k, l] of this.byExe) o[k] = l.map(e => [e.n, e.p]); return o; }
  unpackDetectable(o) { const m = new Map(); for (const k of Object.keys(o || {})) if (Array.isArray(o[k])) m.set(k, o[k].map(e => ({ n: e[0], p: e[1] }))); this.byExe = m; return m.size; }

  // f: { name: "game.exe", path: "C:\\...\\game.exe" } -> { name, exe, sid, img, how } or null
  identify(f) {
    if (!f || !f.name) return null;
    const exe = String(f.name).toLowerCase(), p = norm(f.path);
    if (!/\.exe$/.test(exe)) return null;
    if (this.notGames[exe]) return null;
    if (this.custom[exe]) return { name: this.custom[exe], exe, sid: 0, img: "", how: "yours" };
    if (this.builtin[exe]) { const d = p && this.dirs.find(x => p.startsWith(x.dir)); return { name: this.builtin[exe], exe, sid: d ? d.sid || 0 : 0, img: d ? d.img || "" : "", how: "built-in" }; }
    if (NEVER_EXE.test(exe) || NOT_GAME_EXE.test(exe)) return null;
    if (p) {
      if (/^[a-z]:\\windows\\/.test(p)) return null;
      const d = this.dirs.find(x => p.startsWith(x.dir));
      if (d) return { name: d.name, exe, sid: d.sid || 0, img: d.img || "", how: "library" };
    }
    const cands = this.byExe.get(exe);
    if (cands) {
      const exact = p ? cands.filter(c => c.p.includes("\\") && p.endsWith("\\" + c.p)) : [];
      if (exact.length) return { name: exact[0].n, exe, sid: 0, img: "", how: "list" };
      // installed somewhere unusual: fine as long as only one game uses that program name and the name isn't a vague one
      const names = [...new Set(cands.map(c => c.n))];
      if (names.length === 1 && !VAGUE_EXE.test(exe)) return { name: names[0], exe, sid: 0, img: "", how: "list" };
    }
    if (p) {
      const m = LAUNCHER_DIR.exec(p);
      if (m && !NOT_GAME_DIR.test(m[2])) {
        const plain = m[1].toLowerCase() === "games";
        // a plain "Games" folder is only a hint: take it when the program sits near the top of its game's folder
        if (!plain || p.slice(m.index + m[0].length).split("\\").length <= 4) return { name: nice(orig(f.path, m[2])) || niceExe(exe), exe, sid: 0, img: "", how: "folder" };
      }
    }
    return null;
  }
  // a readable guess at a program's name, for the "is this a game?" list
  guessName(f) { const p = norm(f && f.path), m = LAUNCHER_DIR.exec(p); return (m && !NOT_GAME_DIR.test(m[2]) && nice(orig(f.path, m[2]))) || niceExe(f && f.name) || String(f && f.name || ""); }
  // worth offering in the "is this a game?" list (not Windows itself, not a browser...)
  couldBeGame(f) { const exe = String(f && f.name || "").toLowerCase(), p = norm(f && f.path); return /\.exe$/.test(exe) && !NEVER_EXE.test(exe) && !NOT_GAME_EXE.test(exe) && !/^[a-z]:\\windows\\/.test(p) && !/\\windowsapps\\microsoft\./.test(p); }
}
// the folder name with its original capitals (the matching is done in lower case)
function orig(fullPath, lowerPart) { const s = String(fullPath || "").replace(/\//g, "\\"), i = s.toLowerCase().indexOf("\\" + lowerPart.toLowerCase() + "\\"); return i < 0 ? lowerPart : s.slice(i + 1, i + 1 + lowerPart.length); }

module.exports = { Detector, niceExe, norm, baseOf };
