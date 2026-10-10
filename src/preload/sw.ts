import { contextBridge, ipcRenderer } from 'electron'

// Service-worker preload: Google Messages may raise notifications from its
// service worker instead of the page. Route those to the RexMessages popup.

contextBridge.exposeInMainWorld('__rexSwBridge', {
  notify: (data: { sender: string; body: string; icon?: string; tag?: string }) => {
    ipcRenderer.send('sw:notify', {
      sender: String(data?.sender ?? ''),
      body: String(data?.body ?? ''),
      icon: typeof data?.icon === 'string' ? data.icon : undefined,
      tag: data?.tag ? String(data.tag) : undefined
    })
  }
})

// Serialized into the worker's main world; must stay self-contained.
function swMainWorld(): void {
  const g = globalThis as any
  const bridge = g.__rexSwBridge
  if (!bridge || g.__rexSwInstalled || typeof g.ServiceWorkerRegistration !== 'function') return
  g.__rexSwInstalled = true
  const proto = g.ServiceWorkerRegistration.prototype
  proto.showNotification = function (title: string, options: any = {}): Promise<void> {
    const icon = typeof options.icon === 'string' && /^(https:|data:image\/)/.test(options.icon) ? options.icon : undefined
    bridge.notify({ sender: String(title ?? ''), body: String(options.body ?? ''), icon, tag: options.tag || undefined })
    return Promise.resolve()
  }
  proto.getNotifications = function (): Promise<any[]> {
    return Promise.resolve([])
  }
}

contextBridge.executeInMainWorld({ func: swMainWorld, args: [] })
