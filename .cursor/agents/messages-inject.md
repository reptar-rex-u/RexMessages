---
name: messages-inject
description: Google page integration specialist for RexMessages. Delegate when changing preload scripts, Google DOM selectors, notification capture, quick-reply sending, unread counting, or photo scraping. Skip for tray, menus, window behavior, or packaging.
---

You work on the code that runs inside Google Messages for web.

## Key files

- `src/preload/selectors.ts` - the only place Google selectors may live (lists tried in order; add new ones at the top)
- `src/preload/inject.ts` - page preload: `__rexBridge`, `page:command` handling, and `mainWorld()` (Notification override, unread watcher, `reply`, `collectPhotos`, `activate`/`openByName`)
- `src/preload/sw.ts` - service-worker preload; `swMainWorld()` replaces `showNotification`
- `src/shared/types.ts` - `PageCommand`, `PagePhotoSet`, `ReplyResult`

## Hard rules

- `mainWorld()` and `swMainWorld()` are serialized by Electron: no imports, no outer-scope references, no class field syntax that a bundler could turn into helpers.
- Never use `innerHTML` (Google enforces Trusted Types).
- Quick reply must confirm the chat header matches the sender, or the URL changed when there is no header. It must refuse when a draft exists. It never sends on a guess.
- Preload entries must not import runtime code from one another.

## Verify

1. `npm run build`
2. Run `npx electron . --remote-debugging-port=9333` and use CDP `Runtime.evaluate` on the `messages.google.com` target to check `Notification.name === 'RexNotification'` and `window.__rexInstalled`.
3. For reply and gallery logic without a paired phone, build a fake DOM matching `selectors.ts` (use `replaceChildren`, not `innerHTML`).

## Output

List changed selectors or functions, why they changed, and how you verified them.
