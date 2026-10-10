import { app, dialog } from 'electron'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { autoUpdater } from 'electron-updater'
import { setQuitting } from './windows'

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000
const FIRST_CHECK_DELAY_MS = 15 * 1000

export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'downloading'; version: string; percent: number }
  | { status: 'ready'; version: string }
  | { status: 'error'; message: string }

let state: UpdateState = { status: 'idle' }
let manualCheck = false
let onChange: (state: UpdateState) => void = () => {}

const logFile = join(app.getPath('userData'), 'updater.log')
function log(level: string, ...args: unknown[]): void {
  const line = `${new Date().toISOString()} [${level}] ${args.map(String).join(' ')}\n`
  try {
    appendFileSync(logFile, line)
  } catch {
    // Logging is best-effort.
  }
}

function setState(next: UpdateState): void {
  state = next
  onChange(state)
}

export function getUpdateState(): UpdateState {
  return state
}

export function initUpdater(changed: (state: UpdateState) => void): void {
  onChange = changed
  if (!app.isPackaged) return

  autoUpdater.logger = {
    info: (...a: unknown[]) => log('info', ...a),
    warn: (...a: unknown[]) => log('warn', ...a),
    error: (...a: unknown[]) => log('error', ...a),
    debug: (...a: unknown[]) => log('debug', ...a)
  }
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.disableWebInstaller = true

  autoUpdater.on('checking-for-update', () => setState({ status: 'checking' }))
  autoUpdater.on('update-available', (info) => setState({ status: 'downloading', version: info.version, percent: 0 }))
  autoUpdater.on('download-progress', (p) => {
    const percent = Math.round(p.percent)
    if (state.status === 'downloading' && percent !== state.percent) setState({ ...state, percent })
  })
  autoUpdater.on('update-not-available', () => {
    setState({ status: 'idle' })
    if (manualCheck) {
      manualCheck = false
      void dialog.showMessageBox({
        type: 'info',
        title: 'RexMessages',
        message: "You're up to date",
        detail: `Version ${app.getVersion()} is the latest.`
      })
    }
  })
  autoUpdater.on('update-downloaded', (info) => {
    manualCheck = false
    setState({ status: 'ready', version: info.version })
  })
  autoUpdater.on('error', (err) => {
    setState({ status: 'error', message: err?.message ?? String(err) })
    if (manualCheck) {
      manualCheck = false
      void dialog.showMessageBox({
        type: 'warning',
        title: 'RexMessages',
        message: "Couldn't check for updates",
        detail: err?.message ?? String(err)
      })
    }
  })

  setTimeout(() => void checkForUpdates(false), FIRST_CHECK_DELAY_MS)
  setInterval(() => void checkForUpdates(false), CHECK_EVERY_MS)
}

export async function checkForUpdates(manual: boolean): Promise<void> {
  if (!app.isPackaged) {
    if (manual) {
      void dialog.showMessageBox({
        type: 'info',
        title: 'RexMessages',
        message: 'Updates only work in the installed app',
        detail: 'Install RexMessages with the setup file to get automatic updates.'
      })
    }
    return
  }
  if (state.status === 'checking' || state.status === 'downloading') return
  if (state.status === 'ready') {
    if (manual) restartToUpdate()
    return
  }
  manualCheck = manual
  try {
    await autoUpdater.checkForUpdates()
  } catch {
    // Reported through the 'error' event.
  }
}

export function restartToUpdate(): void {
  if (state.status !== 'ready') return
  setQuitting()
  autoUpdater.quitAndInstall(false, true)
}
