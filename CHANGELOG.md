# Changelog

## 0.1.4 - 2026-10-10

- Update checks start 5 seconds after launch instead of 15
- A ready update now asks **Restart now** / **Later** in a dialog; the old tray balloon was often hidden by Windows 11

## 0.1.3 - 2026-10-10

- Popups now appear when RexMessages starts hidden or sits in the tray: the page is told the window isn't focused, so Google raises notifications
- Quick reply works again: it uses Google's visible reply box and Send button (Google added hidden duplicates) and presses Send with a real click
- Quick reply confirms the new chat header and only succeeds if the same chat is still open and the box cleared
- Exact name matching, so a reply to "Alexis" can never go to the group "Alexis, Mom"
- Remembers the Google account address (`/web/u/0/`) after sign-in and opens it on startup

## 0.1.2 - 2026-10-10

- Google Account sign-in works: the window reports a full Google Chrome identity (client hints and `window.chrome`), which Google's sign-in requires
- The Sign in button is back; QR pairing stays available under **File > Pair with QR code**
- RexMessages page hooks no longer run on Google's sign-in pages
- Shows an explanation if Google still rejects the sign-in

## 0.1.1 - 2026-10-10

- Opens straight to QR pairing; Google blocks account sign-in in desktop apps, so the Sign in button now explains this and stays on the QR page
- Turns on **Remember this computer** automatically while pairing
- New **File > Pair with QR code** menu item

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
