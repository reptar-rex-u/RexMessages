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

export function setPageTarget(wc: WebContents): void {
  target = wc
}

export function isPageSender(wc: WebContents): boolean {
  return wc === target
}

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
