import type { BrowserWindow } from 'electron'

let mainWindow: BrowserWindow | null = null
let quitting = false

export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

export function isQuitting(): boolean {
  return quitting
}

export function setQuitting(): void {
  quitting = true
}

export function showMain(): void {
  const win = getMainWindow()
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

export function toggleMain(): void {
  const win = getMainWindow()
  if (!win) return
  if (win.isVisible() && win.isFocused()) win.hide()
  else showMain()
}

export function isMainActive(): boolean {
  const win = getMainWindow()
  return !!win && win.isVisible() && !win.isMinimized() && win.isFocused()
}
