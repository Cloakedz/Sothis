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

Styles: `css/01-base.css` onwards, in the same order they used to appear.
