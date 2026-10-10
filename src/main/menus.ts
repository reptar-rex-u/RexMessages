import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import { getSettings, updateSettings } from './store'
import { refreshTrayMenu, getUnread } from './tray'
import { pushPopupSettings } from './notify'
import { openGallery } from './gallery'
import { getMainWindow, showMain } from './windows'
import { checkForUpdates, getUpdateState, restartToUpdate } from './updater'

const POPUP_DURATIONS = [5, 8, 15, 30]

export function applyLoginItem(enabled: boolean): void {
  app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] })
}

function toggle(key: 'doNotDisturb' | 'sound' | 'startWithWindows'): void {
  const next = updateSettings({ [key]: !getSettings()[key] })
  if (key === 'startWithWindows') applyLoginItem(next.startWithWindows)
  if (key === 'sound') pushPopupSettings()
  refreshMenus()
}

function setPopupSeconds(seconds: number): void {
  updateSettings({ popupSeconds: seconds })
  pushPopupSettings()
  refreshMenus()
}

function optionItems(): MenuItemConstructorOptions[] {
  const s = getSettings()
  return [
    { label: 'Do not disturb', type: 'checkbox', checked: s.doNotDisturb, click: () => toggle('doNotDisturb') },
    { label: 'Notification sound', type: 'checkbox', checked: s.sound, click: () => toggle('sound') },
    {
      label: 'Popup duration',
      submenu: POPUP_DURATIONS.map((sec) => ({
        label: `${sec} seconds`,
        type: 'radio' as const,
        checked: s.popupSeconds === sec,
        click: () => setPopupSeconds(sec)
      }))
    },
    { type: 'separator' },
    { label: 'Start with Windows', type: 'checkbox', checked: s.startWithWindows, click: () => toggle('startWithWindows') }
  ]
}

function quit(): void {
  app.quit()
}

function updateItems(): MenuItemConstructorOptions[] {
  const u = getUpdateState()
  switch (u.status) {
    case 'ready':
      return [{ label: `Restart to update to ${u.version}`, click: restartToUpdate }]
    case 'downloading':
      return [{ label: `Downloading update ${u.version} (${u.percent}%)`, enabled: false }]
    case 'checking':
      return [{ label: 'Checking for updates...', enabled: false }]
    default:
      return [{ label: 'Check for updates', click: () => void checkForUpdates(true) }]
  }
}

export function buildAppMenu(): Menu {
  return Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        { label: 'Photo gallery', accelerator: 'CmdOrCtrl+G', click: () => openGallery() },
        { type: 'separator' },
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => getMainWindow()?.webContents.reload() },
        { label: 'Hide to tray', accelerator: 'CmdOrCtrl+W', click: () => getMainWindow()?.hide() },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: quit }
      ]
    },
    { label: 'Options', submenu: optionItems() },
    {
      label: 'View',
      submenu: [
        { role: 'zoomIn', accelerator: 'CmdOrCtrl+=' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        ...updateItems(),
        { type: 'separator' },
        { label: `RexMessages ${app.getVersion()}`, enabled: false }
      ]
    }
  ])
}

export function buildTrayMenu(): Menu {
  const unread = getUnread()
  return Menu.buildFromTemplate([
    { label: unread ? `Show RexMessages (${unread} unread)` : 'Show RexMessages', click: showMain },
    { label: 'Photo gallery', click: () => openGallery() },
    { type: 'separator' },
    ...optionItems(),
    { type: 'separator' },
    ...updateItems(),
    { label: 'Quit', click: quit }
  ])
}

export function refreshMenus(): void {
  Menu.setApplicationMenu(buildAppMenu())
  refreshTrayMenu()
}
