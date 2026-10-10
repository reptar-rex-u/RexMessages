import { contextBridge, ipcRenderer } from 'electron'
import type { IncomingMessage, PopupSettings, ReplyResult } from '../shared/types'

contextBridge.exposeInMainWorld('rex', {
  onAdd: (cb: (msg: IncomingMessage) => void) => ipcRenderer.on('popup:add', (_e, msg) => cb(msg)),
  onRemove: (cb: (id: number) => void) => ipcRenderer.on('popup:remove', (_e, id) => cb(id)),
  onSettings: (cb: (s: PopupSettings) => void) => ipcRenderer.on('popup:settings', (_e, s) => cb(s)),
  reply: (id: number, sender: string, text: string): Promise<ReplyResult> =>
    ipcRenderer.invoke('popup:reply', { id, sender, text }),
  open: (id: number, sender: string) => ipcRenderer.send('popup:open', { id, sender }),
  resize: (height: number) => ipcRenderer.send('popup:resize', height),
  empty: () => ipcRenderer.send('popup:empty')
})
