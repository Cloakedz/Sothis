# Sothis

A gaming companion for Windows: YouTube Music player, game stats (Overwatch, Counter-Strike 2, Rainbow Six Siege), Discord call controls, clips, a retro game library with a built-in emulator, and a phone remote.

## Install

Download **Sothis-Setup-x.y.z.exe** from the [latest release](../../releases/latest) and run it. Sothis installs for your Windows user only (no admin needed) and updates itself from this page.

Windows may show "Windows protected your PC" the first time, because the installer isn't code-signed. Click **More info → Run anyway**.

## Your data stays on your PC

Settings, sign-ins, Discord app secret, notes, play stats and game saves are kept in `%APPDATA%\Sothis` on your own computer. Nothing personal is in this repository, and updates only replace the app files, never that folder. Secrets are encrypted with Windows' own per-user protection.

Optional personal defaults can go in `%APPDATA%\Sothis\personal.json`:

```json
{
  "dcServers": ["My server"],
  "mcAddr": "myserver.example.com",
  "discordClientId": "123456789012345678"
}
```

## Retro games

Sothis plays your own game files with [EmulatorJS](https://github.com/EmulatorJS/EmulatorJS) (GPL-3.0, see `emu/LICENSE-EmulatorJS.txt`). No games are included. Game identification uses the [libretro database](https://github.com/libretro/libretro-database).

## Releases

Each release has two files:
- `Sothis-Setup-x.y.z.exe`: the installer for new PCs
- `sothis-app-x.y.z.zip` (+ `.sha256`): the app files Sothis downloads to update itself
