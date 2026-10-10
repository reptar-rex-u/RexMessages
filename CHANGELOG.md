# Changelog

## 0.1.0 - 2026-10-10

First version.

- Electron wrapper for Google Messages for web with a persistent session, Chrome user agent, and spellcheck
- Corner popups with quick reply, stacking, auto-hide, sound, and Do not disturb
- Quick reply checks the open chat matches the sender and refuses to send otherwise
- Service-worker notifications routed to the same popups, with duplicate filtering
- Tray icon, close to tray, unread badge on the taskbar and tray, Start with Windows, `Ctrl+Alt+M` hotkey
- Photo gallery for the open conversation: grid, viewer with zoom/pan/rotate, Save as, Copy, Open in app, Show in folder, Save all, Load older
- NSIS installer via `npm run dist`
- Automatic updates from GitHub Releases (background download, tray notice, Help > Check for updates), published with `npm run release`
