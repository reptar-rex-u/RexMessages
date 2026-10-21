import { app, dialog } from 'electron'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { autoUpdater } from 'electron-updater'
import { setQuitting } from './windows'
import { getSettings } from './store'

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000
const FIRST_CHECK_DELAY_MS = 5 * 1000

export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'downloading'; version: string; percent: number }
  | { status: 'ready'; version: string }
  | { status: 'error'; message: string }

let state: UpdateState = { status: 'idle' }
let manualCheck = false
let wired = false
let scheduled = false
let firstCheck: NodeJS.Timeout | undefined
let repeatCheck: NodeJS.Timeout | undefined
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

function updatesAllowed(): boolean {
  return getSettings().autoUpdate
}

/** A public release must not replace this build unless Options > Automatic updates is on. */
function applyUpdaterFlags(enabled: boolean): void {
  autoUpdater.autoDownload = enabled
  autoUpdater.autoInstallOnAppQuit = enabled
  autoUpdater.disableWebInstaller = true
}

function stopSchedule(): void {
  clearTimeout(firstCheck)
  clearInterval(repeatCheck)
  firstCheck = undefined
  repeatCheck = undefined
  scheduled = false
}

function startSchedule(): void {
  if (scheduled || !app.isPackaged || !updatesAllowed()) return
  scheduled = true
  firstCheck = setTimeout(() => void checkForUpdates(false), FIRST_CHECK_DELAY_MS)
  repeatCheck = setInterval(() => void checkForUpdates(false), CHECK_EVERY_MS)
}

function wireListeners(): void {
  if (wired) return
  wired = true
  autoUpdater.logger = {
    info: (...a: unknown[]) => log('info', ...a),
    warn: (...a: unknown[]) => log('warn', ...a),
    error: (...a: unknown[]) => log('error', ...a),
    debug: (...a: unknown[]) => log('debug', ...a)
  }

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
    if (!updatesAllowed()) return
    manualCheck = false
    setState({ status: 'ready', version: info.version })
    promptRestart(info.version)
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

}

export function initUpdater(changed: (state: UpdateState) => void): void {
  onChange = changed
  applyUpdaterFlags(false)
  if (updatesAllowed()) setAutoUpdateEnabled(true)
}

/** Turn background checks and install-on-quit on or off without stacking timers. */
export function setAutoUpdateEnabled(enabled: boolean): void {
  applyUpdaterFlags(enabled)
  if (!enabled) {
    stopSchedule()
    return
  }
  if (!app.isPackaged) return
  wireListeners()
  startSchedule()
}

export async function checkForUpdates(manual: boolean): Promise<void> {
  if (!updatesAllowed()) {
    if (manual) {
      void dialog.showMessageBox({
        type: 'info',
        title: 'RexMessages',
        message: 'Automatic updates are off',
        detail: 'This build will not download or install a public release. Turn on Automatic updates under Options to check.'
      })
    }
    return
  }
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

// Windows 11 often hides tray balloons, so ask with a dialog, once per version.
let promptedVersion = ''
function promptRestart(version: string): void {
  if (promptedVersion === version) return
  promptedVersion = version
  void dialog
    .showMessageBox({
      type: 'info',
      title: 'RexMessages',
      message: `RexMessages ${version} is ready to install`,
      detail: `You have version ${app.getVersion()}. Restart now to update, or it will install the next time you quit.`,
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    })
    .then(({ response }) => {
      if (response === 0) restartToUpdate()
    })
}

export function restartToUpdate(): void {
  if (!updatesAllowed() || state.status !== 'ready') return
  setQuitting()
  autoUpdater.quitAndInstall(false, true)
}
