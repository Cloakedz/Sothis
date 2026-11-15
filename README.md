# Sothis

A gaming companion for Windows: a game library and launcher, YouTube Music player, game stats (Overwatch, Counter-Strike 2, Rainbow Six Siege), Discord call controls and a retro game library with a built-in emulator.

## Downloads

Every app has its own installer on the [latest release](https://github.com/Cloakedz/Sothis/releases/latest):

| App | What it is | Download |
| --- | --- | --- |
| **Sothis** | Gaming companion: games, music, stats, Discord | [Sothis-Setup.exe](https://github.com/Cloakedz/Sothis/releases/latest/download/Sothis-Setup.exe) |
| **Blackwall** | Web browser | [Blackwall-Setup.exe](https://github.com/Cloakedz/Sothis/releases/latest/download/Blackwall-Setup.exe) |
| **Braindance** | Video editor | [Braindance-Setup.exe](https://github.com/Cloakedz/Sothis/releases/latest/download/Braindance-Setup.exe) |
| **Afterimage** | Image editor (opens .psd) | [Afterimage-Setup.exe](https://github.com/Cloakedz/Sothis/releases/latest/download/Afterimage-Setup.exe) |

Each installs for your Windows user only (no admin needed). Sothis's top bar opens the other three once they're installed.

## Install

Download **[Sothis-Setup.exe](https://github.com/Cloakedz/Sothis/releases/latest/download/Sothis-Setup.exe)** from the [latest release](https://github.com/Cloakedz/Sothis/releases/latest) and run it. Sothis installs for your Windows user only (no admin needed) and updates itself from this page.

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

Mic noise suppression uses an RNNoise model from [rnnoise-models](https://github.com/GregorR/rnnoise-models) (`noise-model.rnnn`).

## Updates

Sothis checks this repository a few times a day. When `package.json` has a newer version, it downloads the app files from here, swaps them in and shows **Update ready**. Settings and sign-ins are never touched.
