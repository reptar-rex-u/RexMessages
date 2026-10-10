import {
  BrowserWindow,
  ipcMain,
  screen,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type ServiceWorkerMain,
  type Session
} from 'electron'
import type { IncomingMessage, PopupSettings, ReplyResult } from '../shared/types'
import { isPageSender, runPageCommand } from './page'
import { preload, rendererUrl } from './paths'
import { getSettings } from './store'
import { isMainActive, showMain } from './windows'

const WIDTH = 380
const MARGIN = 12

let popup: BrowserWindow | null = null
let ready = false
const queue: IncomingMessage[] = []

function popupSettings(): PopupSettings {
  const s = getSettings()
  return { sound: s.sound, popupSeconds: s.popupSeconds }
}

function ensurePopup(): BrowserWindow {
  if (popup && !popup.isDestroyed()) return popup
  ready = false
  popup = new BrowserWindow({
    width: WIDTH,
    height: 10,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    title: 'RexMessages notification',
    webPreferences: {
      preload: preload('popup'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true
    }
  })
  popup.setAlwaysOnTop(true, 'pop-up-menu')
  popup.webContents.on('did-finish-load', () => {
    ready = true
    popup?.webContents.send('popup:settings', popupSettings())
    for (const msg of queue.splice(0)) popup?.webContents.send('popup:add', msg)
  })
  popup.on('closed', () => {
    popup = null
    ready = false
  })
  const target = rendererUrl('popup')
  if (target.url) void popup.loadURL(target.url)
  else void popup.loadFile(target.file!)
  return popup
}

function isPopupSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return !!popup && !popup.isDestroyed() && event.sender === popup.webContents
}

function deliver(msg: IncomingMessage): void {
  const win = ensurePopup()
  if (ready) win.webContents.send('popup:add', msg)
  else queue.push(msg)
}

export function pushPopupSettings(): void {
  if (popup && ready) popup.webContents.send('popup:settings', popupSettings())
}

export function createPopupWindow(): void {
  ensurePopup()
}

const DEDUPE_MS = 10000
const recent = new Map<string, number>()
let swIds = 0

function handleIncoming(raw: Partial<IncomingMessage>, id: number): void {
  if (getSettings().doNotDisturb || isMainActive()) return
  const sender = String(raw.sender || 'New message').slice(0, 200)
  const body = String(raw.body || '').slice(0, 2000)

  const now = Date.now()
  for (const [key, at] of recent) if (now - at > DEDUPE_MS) recent.delete(key)
  const key = `${sender}\n${body}`
  if (recent.has(key)) return
  recent.set(key, now)

  deliver({
    id,
    sender,
    body,
    icon: typeof raw.icon === 'string' && /^(https:|data:image\/)/.test(raw.icon) ? raw.icon : undefined,
    tag: raw.tag ? String(raw.tag) : undefined,
    receivedAt: now
  })
}

ipcMain.on('page:notify', (event, raw: Partial<IncomingMessage>) => {
  if (isPageSender(event.sender)) handleIncoming(raw, Number(raw.id) || 0)
})

// Service-worker notifications get negative ids so the page falls back to
// finding the conversation by name when replying or opening.
export function attachServiceWorkerNotifications(ses: Session): void {
  const attached = new WeakSet<ServiceWorkerMain>()
  ses.serviceWorkers.on('running-status-changed', ({ versionId, runningStatus }) => {
    if (runningStatus !== 'running') return
    const worker = ses.serviceWorkers.getWorkerFromVersionID(versionId)
    if (!worker || attached.has(worker) || !worker.scope.startsWith('https://messages.google.com/')) return
    attached.add(worker)
    worker.ipc.on('sw:notify', (_event, raw: Partial<IncomingMessage>) => handleIncoming(raw, -++swIds))
  })
}

ipcMain.on('page:closed', (event, id: number) => {
  if (!isPageSender(event.sender)) return
  if (popup && ready) popup.webContents.send('popup:remove', Number(id))
})

ipcMain.handle('popup:reply', async (event, args: { id: number; sender: string; text: string }): Promise<ReplyResult> => {
  if (!isPopupSender(event)) return { ok: false, error: 'Not allowed' }
  const text = String(args.text || '').trim()
  if (!text) return { ok: false, error: 'Type a reply first' }
  try {
    return await runPageCommand<ReplyResult>(
      { cmd: 'reply', payload: { id: Number(args.id), sender: String(args.sender), text } },
      20000
    )
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.on('popup:open', (event, args: { id: number; sender: string }) => {
  if (!isPopupSender(event)) return
  showMain()
  runPageCommand({ cmd: 'open', payload: { id: Number(args.id), sender: String(args.sender) } }).catch(() => {})
})

ipcMain.on('popup:resize', (event, height: number) => {
  if (!isPopupSender(event) || !popup) return
  const area = screen.getPrimaryDisplay().workArea
  const h = Math.max(1, Math.min(Math.ceil(Number(height) || 0), area.height - MARGIN * 2))
  popup.setBounds({
    x: area.x + area.width - WIDTH - MARGIN,
    y: area.y + area.height - h - MARGIN,
    width: WIDTH,
    height: h
  })
  if (!popup.isVisible()) popup.showInactive()
})

ipcMain.on('popup:empty', (event) => {
  if (isPopupSender(event)) popup?.hide()
})
