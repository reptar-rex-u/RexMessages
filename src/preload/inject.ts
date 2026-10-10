import { contextBridge, ipcRenderer } from 'electron'
import { SELECTORS, type Selectors } from './selectors'

type CommandHandler = (cmd: string, payload: unknown) => Promise<unknown>

let handler: CommandHandler | null = null

// Google's sign-in pages must see an untouched browser.
const onMessages = location.hostname === 'messages.google.com'

if (onMessages) contextBridge.exposeInMainWorld('__rexBridge', {
  notify: (data: { id: number; sender: string; body: string; icon?: string; tag?: string }) => {
    ipcRenderer.send('page:notify', {
      id: Number(data?.id) || 0,
      sender: String(data?.sender ?? ''),
      body: String(data?.body ?? ''),
      icon: typeof data?.icon === 'string' ? data.icon : undefined,
      tag: data?.tag ? String(data.tag) : undefined
    })
  },
  closed: (id: number) => ipcRenderer.send('page:closed', Number(id) || 0),
  click: (x: number, y: number): Promise<boolean> => ipcRenderer.invoke('page:click', { x: Number(x), y: Number(y) }),
  unread: (count: number) => ipcRenderer.send('page:unread', Number(count) || 0),
  register: (fn: CommandHandler) => {
    if (!handler) handler = fn
  }
})

ipcRenderer.on('page:focus', (_event, focused: boolean) => {
  window.dispatchEvent(new Event(focused ? 'rex-window-focus' : 'rex-window-blur'))
})

ipcRenderer.on('page:command', async (_event, msg: { reqId: number; cmd: string; payload: unknown }) => {
  const { reqId, cmd, payload } = msg
  if (!handler) {
    ipcRenderer.send('page:result', { reqId, ok: false, error: 'Google Messages is still loading' })
    return
  }
  try {
    const result = await handler(cmd, payload)
    ipcRenderer.send('page:result', { reqId, ok: true, result })
  } catch (err) {
    ipcRenderer.send('page:result', { reqId, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
})

// Runs in Google's page (main world). Electron serializes this function, so it
// must not reference anything outside its own body except the `S` argument.
function mainWorld(S: Selectors): void {
  const w = window as any
  const bridge = w.__rexBridge
  if (!bridge || w.__rexInstalled) return
  w.__rexInstalled = true

  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

  const q = (list: string[], root: ParentNode = document): HTMLElement | null => {
    for (const sel of list) {
      try {
        const el = root.querySelector<HTMLElement>(sel)
        if (el) return el
      } catch {
        // Invalid selector in this Chromium build; try the next one.
      }
    }
    return null
  }

  const qa = (list: string[], root: ParentNode = document): HTMLElement[] => {
    for (const sel of list) {
      try {
        const els = Array.from(root.querySelectorAll<HTMLElement>(sel))
        if (els.length) return els
      } catch {
        // Ignore and try the next selector.
      }
    }
    return []
  }

  // First match that is actually laid out on the page.
  const qv = (list: string[], root: ParentNode = document): HTMLElement | null => {
    for (const sel of list) {
      try {
        for (const el of Array.from(root.querySelectorAll<HTMLElement>(sel))) {
          if (el.getClientRects().length) return el
        }
      } catch {
        // Ignore and try the next selector.
      }
    }
    return null
  }

  const text = (el: Element | null | undefined): string => (el?.textContent || '').replace(/\s+/g, ' ').trim()
  const norm = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
  // Exact after dropping emoji and punctuation, so "Alexis" never matches the
  // group "Alexis, Mom".
  const namesMatch = (a: string, b: string): boolean => {
    const x = norm(a)
    return !!x && x === norm(b)
  }

  async function waitFor<T>(fn: () => T | null | undefined | false, timeout: number, interval = 100): Promise<T | null> {
    const end = Date.now() + timeout
    for (;;) {
      try {
        const v = fn()
        if (v) return v
      } catch {
        // Keep polling.
      }
      if (Date.now() > end) return null
      await sleep(interval)
    }
  }

  function blobToDataUrl(blob: Blob): Promise<string | undefined> {
    return new Promise((resolve) => {
      const fr = new FileReader()
      fr.onload = () => resolve(typeof fr.result === 'string' ? fr.result : undefined)
      fr.onerror = () => resolve(undefined)
      fr.readAsDataURL(blob)
    })
  }

  async function toDataUrl(src: string, timeout = 15000): Promise<string | undefined> {
    if (src.startsWith('data:')) return src
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeout)
    try {
      const res = await fetch(src, { signal: ctrl.signal, credentials: 'include' })
      if (!res.ok) return undefined
      return await blobToDataUrl(await res.blob())
    } catch {
      return undefined
    } finally {
      clearTimeout(timer)
    }
  }

  function canvasCopy(img: HTMLImageElement): string | undefined {
    try {
      if (!img.naturalWidth || !img.naturalHeight) return undefined
      const c = document.createElement('canvas')
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      c.getContext('2d')!.drawImage(img, 0, 0)
      return c.toDataURL('image/png')
    } catch {
      return undefined
    }
  }

  // ---- Notifications -------------------------------------------------------

  const registry = new Map<number, any>()
  let counter = 0

  async function forward(n: any): Promise<void> {
    let icon: string | undefined = typeof n.icon === 'string' ? n.icon : undefined
    if (icon && (icon.startsWith('blob:') || icon.startsWith('/'))) icon = await toDataUrl(icon, 4000)
    bridge.notify({ id: n.__id, sender: String(n.title || ''), body: String(n.body || ''), icon, tag: n.tag || undefined })
  }

  class RexNotification extends EventTarget {
    [key: string]: any

    static get permission(): NotificationPermission {
      return 'granted'
    }

    static requestPermission(cb?: (p: NotificationPermission) => void): Promise<NotificationPermission> {
      if (typeof cb === 'function') cb('granted')
      return Promise.resolve('granted')
    }

    static get maxActions(): number {
      return 2
    }

    constructor(title: string, options: NotificationOptions & Record<string, any> = {}) {
      super()
      this.title = String(title ?? '')
      this.body = options.body ?? ''
      this.icon = options.icon ?? ''
      this.tag = options.tag ?? ''
      this.data = options.data ?? null
      this.silent = !!options.silent
      this.badge = options.badge ?? ''
      this.image = options.image ?? ''
      this.requireInteraction = !!options.requireInteraction
      this.actions = options.actions ?? []
      this.dir = options.dir ?? 'auto'
      this.lang = options.lang ?? ''
      this.timestamp = options.timestamp ?? Date.now()
      this.onclick = null
      this.onshow = null
      this.onclose = null
      this.onerror = null
      this.__clickListeners = 0
      this.__id = ++counter

      if (this.tag) {
        for (const [oid, other] of registry) {
          if (other.tag === this.tag) {
            registry.delete(oid)
            bridge.closed(oid)
          }
        }
      }
      registry.set(this.__id, this)
      void forward(this)
      setTimeout(() => this.__fire('show'), 0)
    }

    addEventListener(type: string, listener: any, options?: any): void {
      if (type === 'click' && listener) this.__clickListeners++
      super.addEventListener(type, listener, options)
    }

    __hasClick(): boolean {
      return typeof this.onclick === 'function' || this.__clickListeners > 0
    }

    __fire(type: string): void {
      const ev = new Event(type, { cancelable: true })
      const h = this['on' + type]
      try {
        if (typeof h === 'function') h.call(this, ev)
      } catch (err) {
        console.error('[RexMessages] notification handler failed', err)
      }
      this.dispatchEvent(ev)
    }

    close(): void {
      if (registry.delete(this.__id)) {
        bridge.closed(this.__id)
        this.__fire('close')
      }
    }
  }

  Object.defineProperty(window, 'Notification', { value: RexNotification, writable: true, configurable: true })

  if (typeof w.ServiceWorkerRegistration === 'function') {
    const proto = w.ServiceWorkerRegistration.prototype
    proto.showNotification = function (title: string, options?: NotificationOptions): Promise<void> {
      new RexNotification(title, options)
      return Promise.resolve()
    }
    proto.getNotifications = function (): Promise<any[]> {
      return Promise.resolve(Array.from(registry.values()))
    }
  }

  // ---- Window focus --------------------------------------------------------

  let windowFocused = false
  const realHasFocus = Document.prototype.hasFocus
  Document.prototype.hasFocus = function (this: Document): boolean {
    return windowFocused && realHasFocus.call(this)
  }
  const setFocus = (focused: boolean): void => {
    if (focused === windowFocused) return
    windowFocused = focused
    window.dispatchEvent(new FocusEvent(focused ? 'focus' : 'blur'))
  }
  window.addEventListener('rex-window-focus', () => setFocus(true))
  window.addEventListener('rex-window-blur', () => setFocus(false))

  // ---- Unread count --------------------------------------------------------

  let lastUnread = -1
  setInterval(() => {
    const m = /^\((\d+)\)/.exec(document.title)
    const count = m ? Number(m[1]) : qa(S.unreadConversation).length
    if (count !== lastUnread) {
      lastUnread = count
      bridge.unread(count)
    }
  }, 1500)

  // ---- Pairing -------------------------------------------------------------

  // Turn "Remember this computer" on once per visit to the QR page so pairing
  // survives restarts. If the user turns it back off, leave it off.
  let rememberHandled = false
  setInterval(() => {
    if (!location.pathname.startsWith(S.authPath)) {
      rememberHandled = false
      return
    }
    if (rememberHandled) return
    const sw = q(S.rememberDeviceSwitch)
    if (!sw) return
    rememberHandled = true
    if (sw.getAttribute('aria-checked') === 'false') sw.click()
  }, 1000)

  // ---- Conversations -------------------------------------------------------

  function openByName(name: string): boolean {
    const matches = qa(S.conversationListItem).filter((item) => namesMatch(text(q(S.conversationItemName, item)), name))
    if (matches.length !== 1) return false
    ;(q(S.conversationItemLink, matches[0]) || matches[0]).click()
    return true
  }

  function activate(id: number, sender: string): boolean {
    const n = registry.get(id)
    if (n && n.__hasClick()) {
      n.__fire('click')
      return true
    }
    return openByName(sender)
  }

  const inConversation = (): boolean => location.pathname.includes(S.conversationPath)
  const valueOf = (el: HTMLElement | null): string =>
    !el ? '' : 'value' in el ? String((el as HTMLTextAreaElement).value) : el.textContent || ''

  function setText(box: HTMLElement, msg: string): void {
    box.focus()
    if (box.isContentEditable) {
      const range = document.createRange()
      range.selectNodeContents(box)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    }
    let ok = false
    try {
      ok = document.execCommand('insertText', false, msg)
    } catch {
      ok = false
    }
    if (ok && valueOf(box).trim() === msg.trim()) return
    if (box instanceof HTMLTextAreaElement || box instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(box), 'value')?.set
      if (setter) setter.call(box, msg)
      else box.value = msg
      box.dispatchEvent(new Event('input', { bubbles: true }))
    } else {
      box.textContent = msg
      box.dispatchEvent(new InputEvent('input', { bubbles: true, data: msg, inputType: 'insertText' }))
    }
  }

  async function reply(p: { id: number; sender: string; text: string }): Promise<{ ok: boolean; error?: string }> {
    const realFocus = window.focus
    window.focus = () => {}
    try {
      if (!activate(p.id, p.sender)) throw new Error(`Couldn't find the conversation with ${p.sender}`)
    } finally {
      setTimeout(() => {
        window.focus = realFocus
      }, 2000)
    }

    const box = await waitFor(() => inConversation() && qv(S.composeInput), 8000)
    if (!box) throw new Error('The reply box did not appear')

    const isSenderChat = (): boolean => {
      const h = q(S.headerName)
      return !!h && namesMatch(text(h), p.sender)
    }
    if (!(await waitFor(isSenderChat, 4000))) {
      const h = q(S.headerName)
      throw new Error(
        h ? `Opened "${text(h)}" instead of ${p.sender}, so nothing was sent` : "Couldn't confirm the conversation, so nothing was sent"
      )
    }
    // Google sometimes reopens the last chat right after load; let it settle.
    await sleep(400)
    const chatPath = location.pathname
    const stillSenderChat = (): boolean => location.pathname === chatPath && isSenderChat()
    if (!stillSenderChat()) throw new Error('The conversation changed while opening, so nothing was sent')

    const input = qv(S.composeInput) || box
    if (valueOf(input).trim()) throw new Error('That chat has an unsent draft, so nothing was sent')
    setText(input, p.text)
    await sleep(150)

    const btn = await waitFor(() => {
      const b = qv(S.sendButton) as HTMLButtonElement | null
      return b && !b.disabled && b.getAttribute('aria-disabled') !== 'true' ? b : null
    }, 3000)
    if (!btn) throw new Error('The send button did not become ready; your text is in the chat')
    if (!stillSenderChat()) throw new Error('The conversation changed before sending; your text may be left as a draft')
    const r = btn.getBoundingClientRect()
    if (!(await bridge.click(r.left + r.width / 2, r.top + r.height / 2))) throw new Error("Couldn't press Send")

    const sent = await waitFor(() => stillSenderChat() && valueOf(qv(S.composeInput) || input).trim() === '', 6000)
    if (!sent) throw new Error('Send did not go through; your text is still in the reply box')
    return { ok: true }
  }

  // ---- Photos --------------------------------------------------------------

  function scroller(): HTMLElement | null {
    const direct = q(S.messageScroller)
    const isScrollable = (el: HTMLElement): boolean =>
      el.scrollHeight > el.clientHeight + 20 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)
    if (direct && isScrollable(direct)) return direct
    let el: HTMLElement | null = q(S.messageImage) || q(S.messageList) || direct
    while (el && el !== document.body) {
      if (isScrollable(el)) return el
      el = el.parentElement
    }
    return null
  }

  async function collectPhotos(p: { older: boolean }): Promise<unknown> {
    if (!inConversation()) throw new Error('Open a conversation in RexMessages first')
    if (p.older) {
      const sc = scroller()
      if (sc) {
        for (let i = 0; i < 5; i++) {
          sc.scrollTop = 0
          await sleep(1000)
        }
      }
    }
    const exclude = S.imageExcludeAncestors.join(',')
    const seen = new Set<string>()
    const photos: Array<{ dataUrl?: string; url: string; width: number; height: number }> = []
    for (const el of qa(S.messageImage)) {
      if (photos.length >= 300) break
      const img = el as HTMLImageElement
      const src = img.currentSrc || img.src
      if (!src || seen.has(src) || src.startsWith('data:image/svg')) continue
      if (exclude && img.closest(exclude)) continue
      const width = img.naturalWidth
      const height = img.naturalHeight
      if (width && height && (width < 64 || height < 64)) continue
      seen.add(src)
      const dataUrl = (await toDataUrl(src)) || canvasCopy(img)
      photos.push({ dataUrl, url: src, width, height })
    }
    return { conversation: text(q(S.headerName)) || 'Conversation', photos }
  }

  // ---- Command handler -----------------------------------------------------

  bridge.register(async (cmd: string, payload: any) => {
    switch (cmd) {
      case 'reply':
        return reply(payload)
      case 'open':
        return activate(Number(payload.id), String(payload.sender))
      case 'collectPhotos':
        return collectPhotos(payload)
      default:
        throw new Error(`Unknown command: ${cmd}`)
    }
  })
}

if (onMessages) contextBridge.executeInMainWorld({ func: mainWorld, args: [SELECTORS] })

// Electron leaves window.chrome empty; Google's sign-in expects the members a
// real Chrome has. Serialized like mainWorld().
if (location.hostname === 'accounts.google.com') {
  contextBridge.executeInMainWorld({
    func: () => {
      const c = ((window as any).chrome ??= {})
      const start = performance.timeOrigin / 1000
      c.app ??= {
        isInstalled: false,
        InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
        RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
        getDetails: () => null,
        getIsInstalled: () => false,
        runningState: () => 'cannot_run'
      }
      c.csi ??= () => ({ startE: Math.round(start * 1000), onloadT: Date.now(), pageT: performance.now(), tran: 15 })
      c.loadTimes ??= () => ({
        requestTime: start,
        startLoadTime: start,
        commitLoadTime: start,
        finishDocumentLoadTime: 0,
        finishLoadTime: 0,
        firstPaintTime: 0,
        firstPaintAfterLoadTime: 0,
        navigationType: 'Other',
        wasFetchedViaSpdy: true,
        wasNpnNegotiated: true,
        npnNegotiatedProtocol: 'h2',
        wasAlternateProtocolAvailable: false,
        connectionInfo: 'h2'
      })
    }
  })
}
