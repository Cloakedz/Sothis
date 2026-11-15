# Sothis's window code

`index.html` holds only the page's markup. Its code and styles live here, split by area. `main.js` joins the files
in the order `parts.json` gives and the page runs the result as **one** script and **one** stylesheet, so everything
still shares one scope exactly as when it was a single block inside `index.html`.

- Edit the file for the area you're changing. Order matters only in `parts.json`; don't rename files without updating it.
- A new file must be added to `parts.json`. Every `.js` file is a slice of the same big function: no wrapper, no `export`.
- Errors show as `sothis-ui.js:LINE`. `node ui/where.js LINE` says which file and line that is.
- After a change run `node tests/unit.js` and `electron tests/smoke.js` (see the top of each file).

| File | What's in it |
| --- | --- |
| 01-shell.js | helpers, mini player, tabs, window buttons, close confirmation, mouse battery, tray, volume sliders |
| 02-stats.js | Overwatch, CS2, Rainbow Six, second accounts, Friends, Minecraft server badge |
| 03-music-home.js | embedded sites, feature switches, lyrics, music service picker, Home, wide layout |
| 04-discord-call.js | Discord call panel |
| 05-music-library.js | add to playlist, search, library, visualizer, battery history |
| 06-claude-browser.js | Claude tab, browser tab |
| 07-games-settings.js | Games tab, weather, look, recognised games, phone, releases, patch notes, daily start, your week, lighting, updates |
| 08-launchers-bell.js | Opera/Discord docking, launcher buttons, notification bell and mixer, server alerts, splash |
| 09-switch.js | Switch tab |
| 10-clips.js | clip button, Clips page, recorder settings |
| 11-keys-sessions.js | corner spacing, keyboard, start, game sessions, gaming settings |
| 12-retro.js | Retro games, retro library, mods |
| 13-home-banner-files.js | Home banner, icon set, Files, idle status, retro player, cheats, compact sidebar, start-up |
| 14-minimal-circuits.js | minimal look switch and the red circuit lines behind the window (same as Blackwall's address bar) |
| 15-music-now.js | Music's "Now playing" view: art, hairline bar, Prev / Play / Next, big synced lyrics (styles in css/09-music-now.css) |
| 16-music-search.js | Search inside Library: a search box at the top of Library, × or Esc goes back (no separate Search button) |
| 17-home-notes-side.js | Home's Notes card moves into the wide layout's side panel, under Last clip |
| 18-home-dash.js | Home in the wide layout: clock, Last game, Last match and Last opened modlist on the left, the Stats page in the middle (styles in css/10-home-dash.css) |
| 19-window-rules.js | no minimize button; Always on top only in the compact sidebar and mini player, never the main window |
| 21-deck.js | the Command Deck look (Nov 2026): top bar with crest, "Sothis" wordmark, your own apps, tabs, Update ready and clock; Home as a grid of panels (Launch, Audio, Comms, Library, Stats, Retro); FILES button on the right edge (styles in css/12-deck.css) |
| 20-app-role.js | Sothis or the game launcher (same code; the launcher's role.json says which): hides the other app's tabs, Home cards and Settings sections (styles in css/11-app-role.css) |

Styles: `css/01-base.css` onwards, in the same order they used to appear. `css/08-minimal.css` is the minimal look (pure black, text tabs, thin type) and the circuit background.
