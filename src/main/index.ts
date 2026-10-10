import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  Menu,
  screen,
  session,
  shell,
  type MenuItemConstructorOptions,
  type Session
} from 'electron'
import { MESSAGES_URL, PAIRING_URL, PARTITION, preload, resource } from './paths'
import { flushSettings, getSettings, updateSettings, type WindowBounds } from './store'
import { setPageTarget } from './page'
import { getMainWindow, isQuitting, setMainWindow, setQuitting, showMain, toggleMain } from './windows'
import { createTray, destroyTray, reapplyBadge, trayBalloon } from './tray'
import { initUpdater, restartToUpdate } from './updater'
import { applyLoginItem, buildTrayMenu, refreshMenus } from './menus'
import { attachServiceWorkerNotifications, createPopupWindow } from './notify'
import { openGallery } from './gallery'
import { cleanupTemp } from './photos'

const TOGGLE_HOTKEY = 'CommandOrControl+Alt+M'
const CHROME_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${
  process.versions.chrome.split('.')[0]
}.0.0.0 Safari/537.36`

const ALLOWED_PERMISSIONS = new Set([
  'notifications',
  'media',
  'clipboard-read',
  'clipboard-sanitized-write',
  'fullscreen',
  'speaker-selection'
])

app.setAppUserModelId('com.rex.rexmessages')
app.userAgentFallback = CHROME_UA

function isGoogleHost(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url)
    return protocol === 'https:' && (hostname === 'google.com' || hostname.endsWith('.google.com'))
  } catch {
    return false
  }
}

function isAccountSignIn(url: string): boolean {
  try {
    return new URL(url).hostname === 'accounts.google.com'
  } catch {
    return false
  }
}

let explaining = false

function explainSignIn(win: BrowserWindow): void {
  if (!win.webContents.getURL().startsWith(PAIRING_URL)) void win.loadURL(PAIRING_URL)
  if (explaining) return
  explaining = true
  void dialog.showMessageBox(win, {
    type: 'info',
    title: 'RexMessages',
    message: 'Pair with the QR code instead',
    detail:
      'Google blocks signing in to your Google Account from desktop apps.\n\n' +
      'On your phone, open Google Messages, tap your profile picture, choose Device pairing, ' +
      'then QR code scanner, and scan the code in this window.'
  }).finally(() => {
    explaining = false
  })
}

function openExternal(url: string): void {
  if (/^(https?:|mailto:|tel:)/i.test(url)) void shell.openExternal(url)
}

let sessionConfigured = false

function configureSession(ses: Session): void {
  if (sessionConfigured) return
  sessionConfigured = true
  ses.setUserAgent(CHROME_UA)
  ses.registerPreloadScript({ id: 'rexmessages-sw', type: 'service-worker', filePath: preload('sw') })
  attachServiceWorkerNotifications(ses)
  ses.setSpellCheckerLanguages(['en-US'])
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    callback(ALLOWED_PERMISSIONS.has(permission) && isGoogleHost(details.requestingUrl))
  })
  ses.setPermissionCheckHandler((_wc, permission, origin) => {
    return ALLOWED_PERMISSIONS.has(permission) && isGoogleHost(origin)
  })
}

function visibleBounds(bounds: WindowBounds): WindowBounds {
  if (bounds.x === undefined || bounds.y === undefined) return { width: bounds.width, height: bounds.height }
  const onScreen = screen.getAllDisplays().some(({ workArea: a }) =>
    bounds.x! + 100 > a.x && bounds.x! < a.x + a.width - 100 && bounds.y! >= a.y - 10 && bounds.y! < a.y + a.height - 100
  )
  return onScreen ? bounds : { width: bounds.width, height: bounds.height }
}

function attachContextMenu(win: BrowserWindow, ses: Session): void {
  win.webContents.on('context-menu', (_event, params) => {
    const wc = win.webContents
    const items: MenuItemConstructorOptions[] = []

    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
        items.push({ label: suggestion, click: () => wc.replaceMisspelling(suggestion) })
      }
      if (!params.dictionarySuggestions.length) items.push({ label: 'No suggestions', enabled: false })
      items.push(
        { label: 'Add to dictionary', click: () => ses.addWordToSpellCheckerDictionary(params.misspelledWord) },
        { type: 'separator' }
      )
    }

    if (params.mediaType === 'image' && params.srcURL) {
      items.push(
        { label: 'Save photo as...', click: () => wc.downloadURL(params.srcURL) },
        { label: 'Copy photo', click: () => wc.copyImageAt(params.x, params.y) },
        { label: 'Open photo gallery', click: () => openGallery() },
        { type: 'separator' }
      )
    }

    if (params.linkURL && !params.linkURL.startsWith('blob:')) {
      items.push(
        { label: 'Open link in browser', click: () => openExternal(params.linkURL) },
        { label: 'Copy link', click: () => void clipboard.writeText(params.linkURL) },
        { type: 'separator' }
      )
    }

    if (params.isEditable) {
      items.push(
        { role: 'cut', enabled: params.editFlags.canCut },
        { role: 'copy', enabled: params.editFlags.canCopy },
        { role: 'paste', enabled: params.editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll' }
      )
    } else if (params.selectionText.trim()) {
      items.push({ role: 'copy' })
    }

    while (items.length && items[items.length - 1].type === 'separator') items.pop()
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win })
  })
}

function createMainWindow(startHidden: boolean): BrowserWindow {
  const settings = getSettings()
  const ses = session.fromPartition(PARTITION)
  configureSession(ses)

  const win = new BrowserWindow({
    ...visibleBounds(settings.bounds),
    minWidth: 480,
    minHeight: 420,
    show: false,
    title: 'RexMessages',
    icon: resource('icon.ico'),
    backgroundColor: '#ffffff',
    webPreferences: {
      partition: PARTITION,
      preload: preload('inject'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
      backgroundThrottling: false
    }
  })
  setMainWindow(win)
  setPageTarget(win.webContents)

  if (settings.maximized) win.maximize()

  win.once('ready-to-show', () => {
    if (!startHidden) win.show()
  })

  win.on('page-title-updated', (event) => event.preventDefault())
  win.on('show', reapplyBadge)
  win.on('focus', () => win.flashFrame(false))

  let boundsTimer: NodeJS.Timeout | undefined
  const saveBounds = (): void => {
    clearTimeout(boundsTimer)
    boundsTimer = setTimeout(() => {
      if (win.isDestroyed() || win.isMinimized()) return
      updateSettings({ maximized: win.isMaximized(), bounds: win.getNormalBounds() })
    }, 400)
  }
  win.on('resize', saveBounds)
  win.on('move', saveBounds)
  win.on('maximize', saveBounds)
  win.on('unmaximize', saveBounds)

  win.on('close', (event) => {
    if (!win.isMinimized()) updateSettings({ maximized: win.isMaximized(), bounds: win.getNormalBounds() })
    if (!isQuitting()) {
      event.preventDefault()
      win.hide()
    }
  })

  // Google blocks account sign-in inside desktop apps, so send people to QR
  // pairing instead of letting them hit "This browser or app may not be secure".
  const toPairing = (url: string): void => {
    try {
      if (new URL(url).pathname.startsWith('/web/welcome')) void win.loadURL(PAIRING_URL)
    } catch {
      // Ignore malformed URLs.
    }
  }
  win.webContents.on('did-navigate', (_event, url) => {
    if (isAccountSignIn(url)) explainSignIn(win)
    else toPairing(url)
  })
  win.webContents.on('will-redirect', (event, url, _isInPlace, isMainFrame) => {
    if (isMainFrame && isAccountSignIn(url)) {
      event.preventDefault()
      explainSignIn(win)
    }
  })
  win.webContents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    if (isMainFrame) toPairing(url)
  })

  win.webContents.on('will-navigate', (event, url) => {
    if (isAccountSignIn(url)) {
      event.preventDefault()
      explainSignIn(win)
    } else if (!isGoogleHost(url)) {
      event.preventDefault()
      openExternal(url)
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAccountSignIn(url)) explainSignIn(win)
    else openExternal(url)
    return { action: 'deny' }
  })

  attachContextMenu(win, ses)
  void win.loadURL(MESSAGES_URL)
  return win
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showMain())

  app.whenReady().then(() => {
    const startHidden = process.argv.includes('--hidden')
    createMainWindow(startHidden)
    refreshMenus()
    createTray(buildTrayMenu)
    createPopupWindow()
    if (app.isPackaged) applyLoginItem(getSettings().startWithWindows)
    initUpdater((state) => {
      refreshMenus()
      if (state.status === 'ready') {
        trayBalloon(
          'RexMessages update ready',
          `Version ${state.version} will install when you quit. Click to restart now.`,
          restartToUpdate
        )
      }
    })
    if (!globalShortcut.register(TOGGLE_HOTKEY, toggleMain)) {
      console.warn(`Could not register ${TOGGLE_HOTKEY}; another app may be using it`)
    }
  })

  app.on('before-quit', () => {
    setQuitting()
    flushSettings()
  })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    destroyTray()
    cleanupTemp()
  })

  app.on('activate', () => {
    if (!getMainWindow()) createMainWindow(false)
    else showMain()
  })

  app.on('window-all-closed', () => {
    // Stay alive in the tray; quitting happens from the menu.
  })
}
