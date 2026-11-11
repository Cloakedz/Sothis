// Checks that need no window.   node tests/unit.js   (GAME_LIST=path-to-detectable.json also tries Discord's real list)
const assert = require("assert"), path = require("path"), fs = require("fs"), os = require("os");
const { Detector, niceExe } = require(path.join(__dirname, "..", "games-detect.js"));
let n = 0; const t = (name, fn) => { try { fn(); n++; console.log("PASS  " + name); } catch (e) { console.log("FAIL  " + name + "   -> " + e.message); process.exitCode = 1; } };

// a pretend Steam + Epic install to scan
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sothis-games-"));
const steam = path.join(tmp, "Steam"), lib2 = path.join(tmp, "Lib2"), epic = path.join(tmp, "EpicManifests");
for (const d of [path.join(steam, "steamapps"), path.join(lib2, "steamapps"), epic]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(steam, "steamapps", "libraryfolders.vdf"), `"libraryfolders"\n{\n "0" { "path" "${steam.replace(/\\/g, "\\\\")}" }\n "1" { "path" "${lib2.replace(/\\/g, "\\\\")}" }\n}`);
const acf = (lib, id, name, dir) => fs.writeFileSync(path.join(lib, "steamapps", `appmanifest_${id}.acf`), `"AppState"\n{\n "appid" "${id}"\n "name" "${name}"\n "StateFlags" "4"\n "installdir" "${dir}"\n}`);
acf(steam, 367520, "Hollow Knight", "Hollow Knight"); acf(lib2, 1145360, "Hades™", "Hades"); acf(steam, 228980, "Steamworks Common Redistributables", "Steamworks Shared");
fs.writeFileSync(path.join(epic, "a.item"), JSON.stringify({ DisplayName: "Alan Wake 2", InstallLocation: path.join(tmp, "Epic Games", "AlanWake2"), bIsApplication: true }));
const D = new Detector();
D.setLists({ builtin: { "cs2.exe": "Counter-Strike 2" }, custom: { "mygame.exe": "My Game" }, notGames: { "notagame.exe": true } });
const id = (name, p) => D.identify({ name, path: p });

t("scans Steam libraries and Epic manifests", () => assert.strictEqual(D.scan({ steamRoot: steam, epicDir: epic }), 3));
t("a Steam game is known by its install folder, in any library", () => { const g = id("hollow_knight.exe", path.join(steam, "steamapps", "common", "Hollow Knight", "hollow_knight.exe")); assert.strictEqual(g.name, "Hollow Knight"); assert.strictEqual(g.sid, 367520); assert(/367520\/header/.test(g.img)); assert.strictEqual(id("Hades.exe", path.join(lib2, "steamapps", "common", "Hades", "x64", "Hades.exe")).name, "Hades"); });
t("an Epic game is known by its install folder", () => assert.strictEqual(id("AlanWake2.exe", path.join(tmp, "Epic Games", "AlanWake2", "AlanWake2.exe")).name, "Alan Wake 2"));
t("the built-in list and your own games still win", () => { assert.strictEqual(id("cs2.exe", "C:\\x\\cs2.exe").name, "Counter-Strike 2"); assert.strictEqual(id("MyGame.exe", "D:\\stuff\\MyGame.exe").name, "My Game"); });
t("a program you marked 'not a game' is never one", () => assert.strictEqual(id("notagame.exe", "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Thing\\notagame.exe"), null));
t("launcher folders give the game's name even with no library entry", () => {
  assert.strictEqual(id("eldenring.exe", "D:\\SteamLibrary\\steamapps\\common\\ELDEN RING\\Game\\eldenring.exe").name, "ELDEN RING");
  assert.strictEqual(id("VALORANT-Win64-Shipping.exe", "C:\\Riot Games\\VALORANT\\live\\ShooterGame\\Binaries\\Win64\\VALORANT-Win64-Shipping.exe").name, "VALORANT");
  assert.strictEqual(id("ACShadows.exe", "C:\\Program Files (x86)\\Ubisoft\\Ubisoft Game Launcher\\games\\Assassin's Creed Shadows\\ACShadows.exe").name, "Assassin's Creed Shadows");
  assert.strictEqual(id("Halo.exe", "C:\\XboxGames\\Halo Infinite\\Content\\Halo.exe").name, "Halo Infinite");
  assert.strictEqual(id("Stardew Valley.exe", "E:\\Games\\Stardew_Valley\\Stardew Valley.exe").name, "Stardew Valley");
});
t("launchers, helpers and everyday programs are not games", () => {
  for (const [e, p] of [["steam.exe", "C:\\Program Files (x86)\\Steam\\steam.exe"], ["steamwebhelper.exe", "C:\\Program Files (x86)\\Steam\\bin\\cef\\steamwebhelper.exe"], ["RiotClientServices.exe", "C:\\Riot Games\\Riot Client\\RiotClientServices.exe"],
    ["UnityCrashHandler64.exe", "D:\\SteamLibrary\\steamapps\\common\\Hollow Knight\\UnityCrashHandler64.exe"], ["EasyAntiCheat_EOS.exe", "C:\\Epic Games\\Fortnite\\EasyAntiCheat_EOS.exe"], ["chrome.exe", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"],
    ["explorer.exe", "C:\\Windows\\explorer.exe"], ["Discord.exe", "C:\\Users\\x\\AppData\\Local\\Discord\\app-1\\Discord.exe"], ["Blackwall.exe", "C:\\Users\\x\\AppData\\Local\\Programs\\Blackwall\\Blackwall.exe"], ["vgc.exe", "C:\\Program Files\\Riot Vanguard\\vgc.exe"],
    ["x.exe", "D:\\SteamLibrary\\steamapps\\common\\Steamworks Shared\\x.exe"], ["obs64.exe", "C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe"], ["random.exe", "C:\\Users\\x\\Downloads\\random.exe"], ["tool.exe", "E:\\Games\\Big Game\\a\\b\\c\\d\\e\\tool.exe"]]) assert.strictEqual(id(e, p), null, e);
});
t("names are tidied", () => { assert.strictEqual(niceExe("HollowKnight-Win64-Shipping.exe"), "Hollow Knight"); assert.strictEqual(niceExe("hades2.exe"), "Hades 2"); assert.strictEqual(D.guessName({ name: "foo_bar.exe", path: "C:\\x\\foo_bar.exe" }), "Foo Bar"); });
t("Discord's list: found by program name; a name two games share, or a vague one, is not trusted", () => {
  D.setDetectable([{ name: "Deep Rock", executables: [{ name: "fsd/binaries/win64/fsd-win64-shipping.exe", os: "win32" }] }, { name: "Mac Thing", executables: [{ name: "thing.exe", os: "darwin" }] },
    { name: "Solo", executables: [{ name: "sologame.exe", os: "win32" }] }, { name: "A", executables: [{ name: "game.exe", os: "win32" }] }, { name: "L", executables: [{ name: "lgame.exe", os: "win32", is_launcher: true }] },
    { name: "Twin1", executables: [{ name: "twin.exe", os: "win32" }] }, { name: "Twin2", executables: [{ name: "twin.exe", os: "win32" }] }]);
  assert.strictEqual(id("FSD-Win64-Shipping.exe", "F:\\Stuff\\DRG\\FSD\\Binaries\\Win64\\FSD-Win64-Shipping.exe").name, "Deep Rock");
  assert.strictEqual(id("fsd-win64-shipping.exe", "F:\\Other\\fsd-win64-shipping.exe").name, "Deep Rock");
  assert.strictEqual(id("sologame.exe", "F:\\Anywhere\\sologame.exe").name, "Solo");
  for (const e of ["thing.exe", "game.exe", "lgame.exe", "twin.exe"]) assert.strictEqual(id(e, "F:\\Anywhere\\" + e), null, e);
  const packed = JSON.parse(JSON.stringify(D.packDetectable())); const D2 = new Detector(); D2.unpackDetectable(packed); assert.strictEqual(D2.identify({ name: "sologame.exe", path: "F:\\a\\sologame.exe" }).name, "Solo");
});
if (process.env.GAME_LIST) t("Discord's real list loads and recognises known games", () => {
  const R = new Detector(); const count = R.setDetectable(JSON.parse(fs.readFileSync(process.env.GAME_LIST, "utf8"))); assert(count > 5000, "only " + count);
  const want = [["left4dead2.exe", "D:\\Old\\left4dead2.exe", /Left 4 Dead 2/i], ["Terraria.exe", "D:\\Portable\\Terraria\\Terraria.exe", /Terraria/i], ["RocketLeague.exe", "D:\\rl\\Binaries\\Win64\\RocketLeague.exe", /Rocket League/i], ["GenshinImpact.exe", "D:\\Genshin Impact\\Genshin Impact game\\GenshinImpact.exe", /Genshin/i], ["Among Us.exe", "D:\\au\\Among Us.exe", /Among Us/i]];
  for (const [e, p, rx] of want) { const g = R.identify({ name: e, path: p }); assert(g && rx.test(g.name), e + " -> " + JSON.stringify(g)); }
  for (const e of ["chrome.exe", "explorer.exe", "Discord.exe", "steam.exe", "obs64.exe", "spotify.exe", "code.exe", "javaw.exe"]) assert.strictEqual(R.identify({ name: e, path: "C:\\x\\" + e }), null, e);
  console.log("      (" + count + " program names from the list; saved size " + Math.round(JSON.stringify(R.packDetectable()).length / 1024) + " KB)");
});
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
console.log(process.exitCode ? "\nSome checks FAILED" : "\nAll " + n + " checks passed");
