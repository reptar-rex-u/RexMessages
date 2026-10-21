import { ipcMain, type WebContents } from 'electron'
import type { PageCommand } from '../shared/types'

interface Pending {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
}

const pending = new Map<number, Pending>()
let nextId = 1
let target: WebContents | null = null

ipcMain.on('page:result', (event, msg: { reqId: number; ok: boolean; result?: unknown; error?: string }) => {
  if (event.sender !== target) return
  const p = pending.get(msg.reqId)
  if (!p) return
  pending.delete(msg.reqId)
  clearTimeout(p.timer)
  if (msg.ok) p.resolve(msg.result)
  else p.reject(new Error(msg.error || 'Page command failed'))
})

// Google's send button ignores script-dispatched clicks, so the page asks for a
// real input event at the button's position.
ipcMain.handle('page:click', async (event, p: { x: number; y: number }): Promise<boolean> => {
  if (event.sender !== target) return false
  const x = Number(p?.x)
  const y = Number(p?.y)
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) return false
  const wc = event.sender
  if (wc.debugger.isAttached()) {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await wc.debugger.sendCommand('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
    }
  } else {
    wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
    wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
  }
  return true
})

export function setPageTarget(wc: WebContents): void {
  target = wc
}

export function isPageSender(wc: WebContents): boolean {
  return wc === target
}

export function isPageLoaded(): boolean {
  return !!target && !target.isDestroyed()
}

// Menus and confirmations need a real key, same as Send needs a real click.
// Only Escape is allowed: this must not type into the compose box.
ipcMain.handle('page:key', async (event, p: { key: string }): Promise<boolean> => {
  if (event.sender !== target) return false
  if (p?.key !== 'Escape') return false
  const wc = event.sender
  try {
    if (wc.debugger.isAttached()) {
      const spec = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 }
      await wc.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', ...spec })
      await wc.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', ...spec })
    } else {
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
      wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
    }
    return true
  } catch (err) {
    console.warn('page:key failed', err)
    return false
  }
})

export function runPageCommand<T>(command: PageCommand, timeoutMs = 20000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (!target || target.isDestroyed()) {
      reject(new Error('Google Messages is not loaded'))
      return
    }
    const reqId = nextId++
    const timer = setTimeout(() => {
      pending.delete(reqId)
      reject(new Error('Google Messages did not respond in time'))
    }, timeoutMs)
    pending.set(reqId, { resolve: resolve as (v: unknown) => void, reject, timer })
    target.send('page:command', { reqId, ...command })
  })
}
