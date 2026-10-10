import { ipcMain, Tray, type Menu, type NativeImage } from 'electron'
import { image } from './paths'
import { isPageSender } from './page'
import { getMainWindow, toggleMain } from './windows'

let tray: Tray | null = null
let buildMenu: (() => Menu) | null = null
let unread = 0
let icons: { normal: NativeImage; unread: NativeImage } | null = null
const badges = new Map<string, NativeImage>()

function badge(count: number): NativeImage {
  const key = count > 9 ? '9plus' : String(count)
  let img = badges.get(key)
  if (!img) {
    img = image('badges', `${key}.png`)
    badges.set(key, img)
  }
  return img
}

export function createTray(menuBuilder: () => Menu): void {
  buildMenu = menuBuilder
  icons = { normal: image('tray.png'), unread: image('tray-unread.png') }
  tray = new Tray(icons.normal)
  tray.setToolTip('RexMessages')
  tray.on('click', () => toggleMain())
  refreshTrayMenu()
}

export function refreshTrayMenu(): void {
  if (tray && buildMenu) tray.setContextMenu(buildMenu())
}

export function getUnread(): number {
  return unread
}

export function setUnread(count: number): void {
  const previous = unread
  unread = Math.max(0, Math.floor(count) || 0)
  if (unread === previous) return

  const label = unread ? `RexMessages - ${unread} unread` : 'RexMessages'
  if (tray && icons) {
    tray.setImage(unread ? icons.unread : icons.normal)
    tray.setToolTip(label)
  }

  const win = getMainWindow()
  if (win) {
    win.setOverlayIcon(unread ? badge(unread) : null, unread ? `${unread} unread` : '')
    win.setTitle(unread ? `RexMessages (${unread})` : 'RexMessages')
    if (unread > previous && win.isVisible() && !win.isFocused()) win.flashFrame(true)
  }
  refreshTrayMenu()
}

export function reapplyBadge(): void {
  const win = getMainWindow()
  if (win && unread) win.setOverlayIcon(badge(unread), `${unread} unread`)
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}

ipcMain.on('page:unread', (event, count: number) => {
  if (isPageSender(event.sender)) setUnread(Number(count))
})
