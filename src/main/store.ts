import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface WindowBounds {
  x?: number
  y?: number
  width: number
  height: number
}

export interface Settings {
  bounds: WindowBounds
  maximized: boolean
  doNotDisturb: boolean
  sound: boolean
  popupSeconds: number
  startWithWindows: boolean
  /** Google account slot after account sign-in, e.g. "/web/u/0/"; empty for QR pairing. */
  accountPath: string
}

const defaults: Settings = {
  bounds: { width: 1100, height: 780 },
  maximized: false,
  doNotDisturb: false,
  sound: true,
  popupSeconds: 8,
  startWithWindows: false,
  accountPath: ''
}

const file = join(app.getPath('userData'), 'settings.json')
let current: Settings = load()
let saveTimer: NodeJS.Timeout | undefined

function load(): Settings {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<Settings>
    return { ...defaults, ...raw, bounds: { ...defaults.bounds, ...raw.bounds } }
  } catch {
    return { ...defaults }
  }
}

function flush(): void {
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(current, null, 2))
  } catch (err) {
    console.error('Failed to save settings', err)
  }
}

export function getSettings(): Readonly<Settings> {
  return current
}

export function updateSettings(patch: Partial<Settings>): Settings {
  current = { ...current, ...patch }
  clearTimeout(saveTimer)
  saveTimer = setTimeout(flush, 300)
  return current
}

export function flushSettings(): void {
  clearTimeout(saveTimer)
  flush()
}
