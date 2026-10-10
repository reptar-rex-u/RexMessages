# RexMessages

Google Messages for web (<https://messages.google.com/web>) wrapped as a real Windows app, with corner popups you can reply from, a tray icon with an unread badge, and a photo gallery for the open conversation.

## Features

- **Stays signed in.** Pair once with the QR code (or your Google account); the session is kept in its own profile.
- **Quick reply popups.** New texts show a card in the bottom-right corner with the sender, preview, and a reply box. Press Enter to send; Shift+Enter adds a new line. Cards stack (up to 4), auto-hide after a few seconds, and pause while you hover or type.
- **Safe sending.** Before sending, the app opens the chat and checks that its header matches the sender. If it can't confirm the chat, or the chat has an unsent draft, nothing is sent and the card says why (use **Open chat** instead).
- **Tray and badge.** Closing the window hides it to the tray. The tray icon and the taskbar button show the unread count.
- **Photo gallery** (File > Photo gallery, or `Ctrl+G`, or right-click a photo). Shows the photos loaded in the open conversation:
  - Grid with hover actions: Save, Copy, Open
  - Viewer with zoom (wheel, `+`/`-`, `0` to fit, double-click), pan (drag), rotate (`R` / `Shift+R`), previous/next (arrow keys)
  - Save as (`Ctrl+S`), Copy (`Ctrl+C`), Open in your default photo app (`Enter`), Show in folder (after saving), Save all
  - Rotations are applied when you save or copy
  - **Load older** scrolls the chat back to pull in older photos
  - Photos are kept in memory only; nothing is written to disk unless you save it
- **Options** (menu bar or tray): Do not disturb, notification sound, popup duration (5/8/15/30 s), Start with Windows.
- **Global hotkey:** `Ctrl+Alt+M` shows or hides the window from anywhere.
- Spellcheck with suggestions, plus a right-click menu for copying photos and links. External links open in your default browser.

## Requirements

- Windows 10 or 11
- Node.js 20.19+ or 22.12+
- An Android phone with Google Messages, set up for Messages for web

## Run

```powershell
cd "R:\RexApps\5. Windows Apps\RexMessages"
npm install
npm run dev        # hot-reload development run
```

On first launch, click **Sign in** (Google account pairing) or use **Pair with QR code** from your phone: Messages > profile picture > Device pairing.

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run build` | Typecheck and build into `out/` |
| `npm start` | Run the built app (`electron-vite preview`) |
| `npm run dist` | Build the Windows installer into `release/` (no upload) |
| `npm run release` | Bump the version and publish an update to GitHub Releases |
| `npm run build:icons` | Regenerate icons in `resources/` |

## Install

Download `RexMessages-Setup-<version>.exe` from the [latest release](https://github.com/reptar-rex-u/RexMessages/releases/latest) and run it. It's a per-user installer with Start menu and desktop shortcuts. The installer isn't code-signed, so Windows SmartScreen may warn on first run (More info > Run anyway).

`npm run dist` builds the same installer locally into `release/` without publishing it.

## Updates

Installed copies check [GitHub Releases](https://github.com/reptar-rex-u/RexMessages/releases) 15 seconds after starting and every 4 hours. New versions download in the background. When one is ready, a tray notification appears; click it (or Help > Restart to update) to install now, or it installs the next time you quit. Help > Check for updates checks on demand. The update log is `%APPDATA%\RexMessages\updater.log`.

### Publishing an update

1. Commit your changes.
2. Run one of:

   ```powershell
   npm run release              # 0.1.0 -> 0.1.1
   npm run release -- minor     # 0.1.0 -> 0.2.0
   npm run release -- major     # 0.1.0 -> 1.0.0
   npm run release -- current   # publish the version already in package.json
   ```

The script bumps the version, commits and tags it, builds the installer, uploads it to a new GitHub Release, and pushes. It uses your `gh auth login` token (or `GH_TOKEN`). Add a line to `CHANGELOG.md` before releasing.

## How it works

```
messages.google.com/web  --(preload inject.ts)-->  main process  -->  popup window / tray / gallery window
service worker           --(preload sw.ts)------>  main process
```

- `src/main/` - Electron main process: window, tray, menus, popup positioning, gallery, and photo file actions
- `src/preload/inject.ts` - runs inside Google's page; replaces `window.Notification`, tracks unread count, sends quick replies, and collects photos
- `src/preload/sw.ts` - runs inside Google's service worker so its notifications also become popups
- `src/preload/selectors.ts` - **every Google DOM selector, in one file**
- `src/renderer/popup/`, `src/renderer/gallery/` - popup and gallery UIs (plain TypeScript, no framework)

Settings are saved in `%APPDATA%\RexMessages\settings.json`. The Google session lives in the app's `persist:messages` profile under the same folder.

## When Google changes their site

Google updates Messages for web regularly, and that can break quick reply, the unread count, or the gallery. Everything still works as a normal Messages window; only the extras stop. To fix:

1. Open View > Toggle Developer Tools in the main window.
2. Inspect the element that stopped working (reply box, send button, chat header, photo).
3. Update the matching list in `src/preload/selectors.ts`. Each list is tried in order, so add new selectors at the top.

## Known limits

- Notifications only arrive while the phone is connected and RexMessages is running (it stays in the tray).
- The gallery only sees photos Google has loaded for the open conversation; use **Load older** for more.
- Quick reply opens the conversation in the background, which marks it as read.

## Cursor subagents

| Agent | Use for |
| --- | --- |
| `messages-inject` | Preload scripts and Google DOM selectors (notifications, quick reply, photo scraping) |
| `messages-shell` | Main process: windows, tray, popup, gallery window, menus, packaging |
| `messages-docs` | README and CHANGELOG |

See `.cursor/rules/subagent-delegation.mdc`.
