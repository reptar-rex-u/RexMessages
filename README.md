# RexMessages

Google Messages for web (<https://messages.google.com/web>) wrapped as a real Windows app, with corner popups you can reply from, a tray icon with an unread badge, and a photo gallery for the open conversation.

## Features

- **Stays signed in.** Sign in with your Google account (or pair with a QR code) once; the session is kept in its own profile.
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
- **Local notes API.** While the app is running, an assistant can read and delete messages in the My Notes conversation over `127.0.0.1` port 5190. Details below.

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

On first launch, click **Sign in** and sign in to the same Google account your phone's Messages app uses (newer phones only offer this Google Account pairing). If your phone shows a **QR code scanner** under Device pairing, you can use **File > Pair with QR code** instead; **Remember this computer** is switched on automatically.

Google refuses sign-in from browsers it doesn't recognize ("This browser or app may not be secure"). Electron normally reports itself as plain Chromium, so the main window reports the same Chrome identity (user agent, client hints, `window.chrome`) a real Chrome build would. You type your password into Google's own page; the app never reads or stores it. If Google still refuses, the app shows a short explanation.

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run build` | Typecheck and build into `out/` |
| `npm start` | Run the built app (`electron-vite preview`) |
| `npm run dist` | Build the Windows installer into `release/` (no upload) |
| `npm run release` | Bump the version and publish an update to GitHub Releases |
| `npm run build:icons` | Regenerate icons in `resources/` |
| `npm test` | Test the notes API without a Google account |

## Install

Download `RexMessages-Setup-<version>.exe` from the [latest release](https://github.com/reptar-rex-u/RexMessages/releases/latest) and run it. It's a per-user installer with Start menu and desktop shortcuts. The installer isn't code-signed, so Windows SmartScreen may warn on first run (More info > Run anyway).

`npm run dist` builds the same installer locally into `release/` without publishing it.

## Updates

Installed copies check [GitHub Releases](https://github.com/reptar-rex-u/RexMessages/releases) 5 seconds after starting and every 4 hours. New versions download in the background. When one is ready, a dialog asks **Restart now** or **Later**; Later installs it the next time you quit (Help > Restart to update also works). Help > Check for updates checks on demand. The update log is `%APPDATA%\RexMessages\updater.log`.

### Publishing an update

1. Commit your changes.
2. Run one of:

   ```powershell
   npm run release              # 0.1.0 -> 0.1.1
   npm run release -- minor     # 0.1.0 -> 0.2.0
   npm run release -- major     # 0.1.0 -> 1.0.0
   npm run release -- current   # publish the version already in package.json
   npm run release -- notes     # only rewrite the current release's notes
   ```

The script bumps the version, commits and tags it, builds the installer, uploads it to a new GitHub Release, and pushes. It uses your `gh auth login` token (or `GH_TOKEN`). Add a line to `CHANGELOG.md` before releasing.

## Local notes API

RexMessages keeps no message store of its own. The API reads and deletes by driving the Google Messages page already open in the app: it opens the named conversation, and a delete uses that message's own menu, then Delete, then confirm.

It listens on **127.0.0.1** port **5190** only. `notesApiPort` in `%APPDATA%\RexMessages\settings.json` changes the port. Set it to `0` to turn the API off. Restart the app after changing it.

On first launch the app writes a token to `%APPDATA%\RexMessages\notes-api.token`. Send it on every request as `Authorization: Bearer <token>`. The token stays in that file (not in the repo and not in the log). Actions are appended to `%APPDATA%\RexMessages\notes-api.log`.

Call `http://127.0.0.1:5190`, not `localhost`. Localhost may try IPv6 first, and this port is IPv4 loopback only.

```powershell
$token = (Get-Content "$env:APPDATA\RexMessages\notes-api.token" -Raw).Trim()
curl.exe -H "Authorization: Bearer $token" http://127.0.0.1:5190/health
curl.exe -H "Authorization: Bearer $token" "http://127.0.0.1:5190/notes?conversation=My%20Notes"
curl.exe -H "Authorization: Bearer $token" "http://127.0.0.1:5190/notes?conversation=My%20Notes&scroll=3&limit=50"
curl.exe -H "Authorization: Bearer $token" -H "Content-Type: application/json" -d "{\"ids\":[\"PASTE-ID\"]}" http://127.0.0.1:5190/notes/delete
```

| Request | What it does |
| --- | --- |
| `GET /health` | `{ "ok": true, "service": "rexmessages", "port": 5190, "pageLoaded": true }` |
| `GET /notes` | Messages in one conversation, newest first. `conversation` defaults to `My Notes`. |
| `POST /notes/delete` | Deletes exact messages in that conversation. Body is `{ "ids": ["..."] }`, `{ "text": "exact text" }`, or both (`texts` is the list form). |

Each message has `id`, `text`, `urls`, and `timestamp` / `timeLabel` when the page shows a time. `scroll` (0–30) is how many times to jump to the top first so Google loads older messages, the same idea as Load older in the gallery. `limit` (1–200, default 50) is the page size. Pass the last id from the previous response as `before` to get the next older page. `mayHaveOlder` means more history may still be above. `cursorFound` is false when that `before` id was not in the loaded history.

A text match is the full `text` field, case-sensitive. It is not a substring. If that text matches more than one loaded message, or the chat has not been scrolled to the top (so a duplicate might still be hidden), that item is skipped and nothing else is guessed. The response has one result per id and per text.

`conversation` always defaults to `My Notes`. It is never "whichever chat is open." If the open chat has an unsent draft, the API leaves it alone and changes nothing. Delete will not use the conversation-row menu, and it will not confirm a dialog that deletes the whole conversation.

Ids starting with `local:` are a hash of the text and time label. The page often has no stable message id. When `data-message-id`, `msg-id`, or `data-msg-id` is present and looks stable, the id starts with `dom:`. Two messages with the same text and the same time label share an id, and delete refuses that as ambiguous.

Reading or deleting opens that conversation. The window can stay in the tray. If a delete says the message menu could not be pressed, show the RexMessages window and try again.

`npm test` checks the API without Google: token, exact matching, and the loopback server.

## How it works

```
messages.google.com/web  --(preload inject.ts)-->  main process  -->  popup window / tray / gallery window
service worker           --(preload sw.ts)------>  main process
127.0.0.1:5190           --(notes API)--------->  main process  --(page command)-->  the open Google page
```

- `src/main/` - Electron main process: window, tray, menus, popup positioning, gallery, photo file actions, and the notes API (`notesApi.ts`)
- `src/preload/inject.ts` - runs inside Google's page; replaces `window.Notification`, tracks unread count, sends quick replies, collects photos, and reads or deletes notes when the local API asks
- `src/preload/sw.ts` - runs inside Google's service worker so its notifications also become popups
- `src/preload/selectors.ts` - **every Google DOM selector, in one file**
- `src/renderer/popup/`, `src/renderer/gallery/` - popup and gallery UIs (plain TypeScript, no framework)

Quick reply only sends after the chat header exactly matches the sender (emoji and punctuation ignored, so "Alexis" never matches the group "Alexis, Mom"). Google ignores script clicks on its Send button, so the page asks the main process to press it with a real input event, then checks the same chat is still open and the reply box cleared.

While the window is hidden, the page is told it doesn't have focus; otherwise Google assumes you're reading the chat and skips notifications. After Google Account sign-in the app remembers the account address (`/web/u/0/`) and opens it on startup.

Settings are saved in `%APPDATA%\RexMessages\settings.json`. The Google session lives in the app's `persist:messages` profile under the same folder.

## When Google changes their site

Google updates Messages for web regularly, and that can break quick reply, the unread count, or the gallery. Everything still works as a normal Messages window; only the extras stop. To fix:

1. Open View > Toggle Developer Tools in the main window.
2. Inspect the element that stopped working (reply box, send button, chat header, photo).
3. Update the matching list in `src/preload/selectors.ts`. Each list is tried in order, so add new selectors at the top. The notes API uses the message bubble, message menu, and delete confirmation lists in that file.

## Known limits

- Notifications only arrive while the phone is connected and RexMessages is running (it stays in the tray).
- The gallery only sees photos Google has loaded for the open conversation; use **Load older** for more.
- Quick reply opens the conversation in the background, which marks it as read.
- The notes API only answers while RexMessages is running and signed in to Google Messages. A selector change can make `/notes` look empty, or make delete report that the menu was not found.
- Delete scrolls the conversation and clicks the on-screen menu, so it switches the open chat and is slower than deleting from a database.

## Cursor subagents

| Agent | Use for |
| --- | --- |
| `messages-inject` | Preload scripts and Google DOM selectors (notifications, quick reply, photo scraping, notes) |
| `messages-shell` | Main process: windows, tray, popup, gallery window, menus, notes API, packaging |
| `messages-docs` | README and CHANGELOG |

See `.cursor/rules/subagent-delegation.mdc`.
