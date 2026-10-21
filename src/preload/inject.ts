import { contextBridge, ipcRenderer } from 'electron'
import {
  classifyMenu,
  decorateNotes,
  dialogDeletesConversation,
  isMessageDeleteLabel,
  mergeNotes,
  pageNotes,
  parseMessageAria,
  pickConfirmLabel,
  planDeletes,
  sanitizeMessages
} from '../shared/notes'
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
  press: (key: string): Promise<boolean> => ipcRenderer.invoke('page:key', { key: String(key ?? '') }),
  unread: (count: number) => ipcRenderer.send('page:unread', Number(count) || 0),
  parseMessageAria: (label: unknown) => parseMessageAria(typeof label === 'string' ? label : ''),
  decorateNotes: (inputs: unknown) => decorateNotes(inputs),
  mergeNotes: (acc: unknown, visible: unknown) => mergeNotes(sanitizeMessages(acc), sanitizeMessages(visible)),
  pageNotes: (messages: unknown, opts: { before?: string; limit?: number; canScrollUp?: boolean } | null) =>
    pageNotes(sanitizeMessages(messages), {
      before: opts && typeof opts.before === 'string' ? opts.before : '',
      limit: opts && typeof opts.limit === 'number' ? opts.limit : 50,
      canScrollUp: !!(opts && opts.canScrollUp)
    }),
  planDeletes: (messages: unknown, ids: unknown, texts: unknown, historyComplete: unknown) =>
    planDeletes(
      sanitizeMessages(messages).map((msg) => ({ id: msg.id, text: msg.text })),
      Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [],
      Array.isArray(texts) ? texts.filter((text): text is string => typeof text === 'string') : [],
      !!historyComplete
    ),
  classifyMenu: (labels: unknown) =>
    classifyMenu(Array.isArray(labels) ? labels.filter((label): label is string => typeof label === 'string') : []),
  dialogDeletesConversation: (dialogText: unknown) =>
    dialogDeletesConversation(typeof dialogText === 'string' ? dialogText : ''),
  pickConfirmLabel: (labels: unknown) =>
    pickConfirmLabel(Array.isArray(labels) ? labels.filter((label): label is string => typeof label === 'string') : []),
  isMessageDeleteLabel: (label: unknown) => isMessageDeleteLabel(typeof label === 'string' ? label : ''),
  register: (fn: CommandHandler) => {
    if (!handler) handler = fn
  }
})

ipcRenderer.on('page:focus', (_event, focused: boolean) => {
  window.dispatchEvent(new Event(focused ? 'rex-window-focus' : 'rex-window-blur'))
})

let commandChain: Promise<void> = Promise.resolve()

async function dispatchCommand(msg: { reqId: number; cmd: string; payload: unknown }): Promise<void> {
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
}

// One page command at a time, so a notes delete can't overlap quick reply.
ipcRenderer.on('page:command', (_event, msg: { reqId: number; cmd: string; payload: unknown }) => {
  commandChain = commandChain.then(
    () => dispatchCommand(msg),
    () => dispatchCommand(msg)
  )
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

  // ---- Notes ---------------------------------------------------------------
  // There is no messages API on the page. Read and delete go through the DOM.
  // Delete refuses unless the open header matches, and it only uses that
  // bubble's menu — never the conversation-row menu that can trash the chat.

  function fail(code: string): never {
    throw new Error(`notes:${code}`)
  }

  function headerMatches(name: string): boolean {
    const header = q(S.headerName)
    return inConversation() && !!header && namesMatch(text(header), name)
  }

  function unsentDraft(): boolean {
    const box = qv(S.composeInput)
    return !!box && valueOf(box).trim() !== ''
  }

  function scrollableAncestor(start: HTMLElement | null): HTMLElement | null {
    const isScrollable = (el: HTMLElement): boolean =>
      el.scrollHeight > el.clientHeight + 20 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)
    let el = start
    while (el && el !== document.body) {
      if (isScrollable(el)) return el
      el = el.parentElement
    }
    return null
  }

  async function findAndOpen(name: string): Promise<boolean> {
    if (openByName(name)) return true
    const list = q(S.conversationList)
    const sc = scrollableAncestor(list)
    if (!sc) return false
    sc.scrollTop = 0
    await sleep(250)
    for (let i = 0; i < 15; i++) {
      if (openByName(name)) return true
      const prev = sc.scrollTop
      const next = Math.min(sc.scrollHeight, prev + Math.max(120, sc.clientHeight * 0.75))
      if (next === prev) return false
      sc.scrollTop = next
      await sleep(280)
    }
    return openByName(name)
  }

  async function ensureConversation(name: string): Promise<string> {
    if (!name.trim()) fail('not-found-conversation')
    if (headerMatches(name)) return text(q(S.headerName))
    if (unsentDraft()) fail('draft')
    if (!(await findAndOpen(name))) fail('not-found-conversation')
    if (!(await waitFor(() => headerMatches(name), 5000))) fail('wrong-conversation')
    await sleep(350)
    if (!headerMatches(name)) fail('wrong-conversation')
    return text(q(S.headerName))
  }

  function matchesAny(el: Element, list: string[]): boolean {
    for (const sel of list) {
      try {
        if (el.matches(sel)) return true
      } catch {
        // Try the next selector.
      }
    }
    return false
  }

  function nestedWrapper(el: HTMLElement): boolean {
    const parent = el.parentElement
    if (!parent) return false
    for (const sel of S.messageWrapper) {
      try {
        if (parent.closest(sel)) return true
      } catch {
        // Try the next selector.
      }
    }
    return false
  }

  function dateChipBefore(wrapper: HTMLElement): string {
    let el: Element | null = wrapper
    for (let depth = 0; depth < 5 && el; depth++) {
      let prev = el.previousElementSibling
      for (let steps = 0; prev && steps < 8; steps++) {
        if (matchesAny(prev, S.messageDateChip)) return text(prev)
        for (const sel of S.messageDateChip) {
          try {
            const inner = prev.querySelector<HTMLElement>(sel)
            if (inner) return text(inner)
          } catch {
            // Try the next selector.
          }
        }
        prev = prev.previousElementSibling
      }
      el = el.parentElement
    }
    return ''
  }

  function messageBody(wrapper: HTMLElement): {
    domId: string
    text: string
    timeLabel: string
    timeCandidates: string[]
    hrefs: string[]
  } | null {
    const parts = qa(S.messagePart, wrapper)
    const nodes = parts.length ? parts : qa(S.messageTextFallback, wrapper)
    const bits: string[] = []
    const timeCandidates: string[] = []
    let timeLabel = ''
    for (const node of nodes) {
      const inner = parts.length ? q(S.messageTextFallback, node) : null
      const visible = text(inner || node)
      if (visible && bits[bits.length - 1] !== visible) bits.push(visible)
      const aria = node.getAttribute('aria-label') || ''
      if (!aria) continue
      const parsed = bridge.parseMessageAria(aria)
      if (parsed && parsed.timeLabel) {
        if (!timeLabel) timeLabel = String(parsed.timeLabel)
        timeCandidates.push(String(parsed.timeLabel))
        if (!bits.length && parsed.content) bits.push(String(parsed.content))
      }
    }
    const stamp = q(S.messageTimestamp, wrapper)
    if (stamp) {
      const label = text(stamp)
      if (label) {
        if (!timeLabel) timeLabel = label
        timeCandidates.push(label)
      }
      for (const attr of ['datetime', 'title', 'aria-label']) {
        const value = stamp.getAttribute(attr)
        if (value) timeCandidates.push(value)
      }
      const innerTime = stamp.querySelector('time')
      if (innerTime) {
        for (const attr of ['datetime', 'aria-label', 'title']) {
          const value = innerTime.getAttribute(attr)
          if (value) timeCandidates.push(value)
        }
      }
    }
    const chip = dateChipBefore(wrapper)
    if (chip && !/\d{4}/.test(timeLabel)) {
      timeLabel = timeLabel ? `${chip} ${timeLabel}` : chip
      timeCandidates.push(timeLabel)
    }
    const hrefs: string[] = []
    for (const anchor of Array.from(wrapper.querySelectorAll('a[href]'))) {
      const href = anchor.getAttribute('href') || ''
      if (/^https?:\/\//i.test(href)) hrefs.push(href)
    }
    let body = bits.join('\n').trim()
    if (!body && hrefs.length) body = hrefs.join('\n')
    if (!body) return null
    let domId = ''
    for (const attr of S.messageIdAttr) {
      const value = wrapper.getAttribute(attr)
      if (value) {
        domId = value
        break
      }
    }
    return { domId, text: body, timeLabel, timeCandidates, hrefs }
  }

  function scrapePairs(): Array<{ el: HTMLElement; raw: ReturnType<typeof messageBody> & object }> {
    const list = q(S.messageList)
    if (!list) return []
    const pairs: Array<{ el: HTMLElement; raw: NonNullable<ReturnType<typeof messageBody>> }> = []
    for (const el of qa(S.messageWrapper, list)) {
      if (pairs.length >= 2000) break
      if (!list.contains(el) || nestedWrapper(el) || matchesAny(el, S.messageDateChip)) continue
      const raw = messageBody(el)
      if (!raw) continue
      pairs.push({ el, raw })
    }
    return pairs
  }

  function decoratePairs(pairs: Array<{ el: HTMLElement; raw: NonNullable<ReturnType<typeof messageBody>> }>): Array<{ el: HTMLElement; msg: any }> {
    const msgs = bridge.decorateNotes(pairs.map((pair) => pair.raw))
    const out: Array<{ el: HTMLElement; msg: any }> = []
    if (!Array.isArray(msgs)) return out
    for (let i = 0; i < pairs.length && i < msgs.length; i++) out.push({ el: pairs[i].el, msg: msgs[i] })
    return out
  }

  function scrapeVisible(): any[] {
    return decoratePairs(scrapePairs()).map((pair) => pair.msg)
  }

  async function gather(
    minScrolls: number,
    beforeId: string,
    seed: any[]
  ): Promise<{ messages: any[]; canScrollUp: boolean; complete: boolean }> {
    if (!q(S.messageList)) fail('no-message-list')
    let acc = seed.slice()
    let capped = false
    const take = (): void => {
      const merged = bridge.mergeNotes(acc, scrapeVisible())
      acc = Array.isArray(merged) ? merged : acc
      if (acc.length >= 2000) capped = true
    }
    take()
    const maxSteps = Math.min(30, Math.max(0, minScrolls, beforeId ? 30 : minScrolls))
    let stuck = 0
    for (let step = 0; step < maxSteps && !capped; step++) {
      if (beforeId && acc.some((msg) => msg && msg.id === beforeId) && step >= minScrolls) break
      const sc = scroller()
      if (!sc) break
      const prevTop = sc.scrollTop
      const prevLen = acc.length
      if (prevTop <= 0 && step >= minScrolls) break
      sc.scrollTop = 0
      sc.dispatchEvent(new Event('scroll', { bubbles: true }))
      await sleep(700)
      take()
      const top = scroller()?.scrollTop ?? 0
      if (acc.length === prevLen && top === prevTop) {
        stuck++
        if (stuck >= 2) break
      } else {
        stuck = 0
      }
      if (top <= 0 && acc.length === prevLen) break
    }
    const sc = scroller()
    const atTop = !sc || sc.scrollTop <= 20
    return { messages: acc, canScrollUp: (!!sc && sc.scrollTop > 20) || capped || !atTop, complete: !capped && atTop }
  }

  async function listNotes(p: { conversation?: string; scroll?: number; limit?: number; before?: string }): Promise<unknown> {
    const name = String(p.conversation || '')
    const title = await ensureConversation(name)
    const before = typeof p.before === 'string' ? p.before : ''
    const scroll = Math.max(0, Math.min(30, Number(p.scroll) || 0))
    const limit = Math.max(1, Math.min(200, Number(p.limit) || 50))
    const gathered = await gather(scroll, before, [])
    if (!headerMatches(name)) fail('wrong-conversation')
    const paged = bridge.pageNotes(gathered.messages, {
      before,
      limit,
      canScrollUp: gathered.canScrollUp || !gathered.complete
    }) || { messages: [], mayHaveOlder: true, cursorFound: false }
    return {
      conversation: title,
      messages: Array.isArray(paged.messages) ? paged.messages : [],
      mayHaveOlder: !!paged.mayHaveOlder,
      cursorFound: paged.cursorFound !== false
    }
  }

  function labelOf(el: HTMLElement): string {
    return (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim()
  }

  function overlays(selectors: string[]): HTMLElement[] {
    return qa(selectors).filter((el) => el.getClientRects().length > 0)
  }

  async function dismissOverlays(): Promise<void> {
    if (!overlays(S.messageMenu).length && !overlays(S.confirmDialog).length) return
    await bridge.press('Escape')
    await sleep(180)
  }

  async function trustedClick(el: HTMLElement): Promise<boolean> {
    const rect = el.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return false
    return !!(await bridge.click(rect.left + rect.width / 2, rect.top + rect.height / 2))
  }

  function hover(el: HTMLElement): void {
    const rect = el.getBoundingClientRect()
    const init = {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + Math.min(30, Math.max(rect.height / 2, 1)),
      view: window
    }
    for (const type of ['pointerover', 'mouseover', 'mouseenter', 'pointermove', 'mousemove']) {
      el.dispatchEvent(new MouseEvent(type, init))
    }
  }

  function isMenuButton(el: HTMLElement): boolean {
    const label = (el.getAttribute('aria-label') || '').toLowerCase()
    if (!label) return el.hasAttribute('data-e2e-message-more')
    return label === 'more' || label === 'more options' || label.includes('message option') || label.includes('message action')
  }

  function menuButtonFor(wrapper: HTMLElement): HTMLElement | null {
    const list = q(S.messageList)
    const rect = wrapper.getBoundingClientRect()
    for (const sel of S.messageMenuButton) {
      let found: HTMLElement[] = []
      try {
        found = Array.from((list || wrapper).querySelectorAll<HTMLElement>(sel))
      } catch {
        continue
      }
      for (const el of found) {
        if (!el.getClientRects().length || !isMenuButton(el)) continue
        if (wrapper.contains(el)) return el
        if (!list || !list.contains(el)) continue
        const button = el.getBoundingClientRect()
        const vertically = button.bottom > rect.top - 8 && button.top < rect.bottom + 8
        const horizontally = button.left >= rect.left - 8 && button.right <= rect.right + 48
        if (vertically && horizontally) return el
      }
    }
    return null
  }

  async function findWrapper(id: string): Promise<HTMLElement | null> {
    for (let i = 0; i < 10; i++) {
      const hit = decoratePairs(scrapePairs()).find((pair) => pair.msg && pair.msg.id === id)
      if (hit) return hit.el
      const sc = scroller()
      if (!sc) return null
      if (i === 0) {
        sc.scrollTop = sc.scrollHeight
        await sleep(350)
        continue
      }
      if (sc.scrollTop <= 0) return null
      sc.scrollTop = Math.max(0, sc.scrollTop - Math.max(200, sc.clientHeight * 0.8))
      await sleep(400)
    }
    return null
  }

  function resultItem(fields: { id?: string; text?: string; ok: boolean; error?: string; confirm?: string }): Record<string, unknown> {
    const out: Record<string, unknown> = { ok: fields.ok }
    if (fields.id) out.id = fields.id
    if (fields.text) out.text = fields.text
    if (fields.error) out.error = fields.error
    if (fields.confirm) out.confirm = fields.confirm
    return out
  }

  async function deleteOne(name: string, wrapper: HTMLElement, id: string): Promise<{ ok: boolean; error?: string; confirm?: string }> {
    const list = q(S.messageList)
    if (!list || !list.contains(wrapper)) return { ok: false, error: 'message is not in this conversation' }
    if (!headerMatches(name)) return { ok: false, error: 'conversation changed; stopped' }
    await dismissOverlays()
    wrapper.scrollIntoView({ block: 'center', inline: 'nearest' })
    await sleep(120)
    if (!decoratePairs(scrapePairs()).some((pair) => pair.el === wrapper && pair.msg && pair.msg.id === id)) {
      return { ok: false, error: 'message changed before delete' }
    }
    hover(wrapper)
    const btn = await waitFor(() => menuButtonFor(wrapper), 1600)
    if (!btn) return { ok: false, error: 'message menu button not found' }
    const beforeMenus = new Set(overlays(S.messageMenu))
    if (!(await trustedClick(btn))) return { ok: false, error: "couldn't press the message menu" }
    const menu = await waitFor(() => {
      const fresh = overlays(S.messageMenu).filter((el) => !beforeMenus.has(el))
      return fresh.length === 1 ? fresh[0] : null
    }, 2000)
    if (!menu) {
      await dismissOverlays()
      return { ok: false, error: 'message menu did not open' }
    }
    const items = qa(S.messageMenuItem, menu).filter((el) => el.getClientRects().length > 0)
    const kind = bridge.classifyMenu(items.map(labelOf))
    if (kind !== 'message') {
      await dismissOverlays()
      return {
        ok: false,
        error: kind === 'conversation' ? 'refused a conversation menu' : 'message menu was not a single Delete action'
      }
    }
    const del = items.filter((el) => bridge.isMessageDeleteLabel(labelOf(el)))
    if (del.length !== 1) {
      await dismissOverlays()
      return { ok: false, error: 'Delete item was not exact' }
    }
    if (!headerMatches(name)) {
      await dismissOverlays()
      return { ok: false, error: 'conversation changed; stopped' }
    }
    if (!(await trustedClick(del[0]))) {
      await dismissOverlays()
      return { ok: false, error: "couldn't press Delete" }
    }
    const dialog = await waitFor(() => {
      const dialogs = overlays(S.confirmDialog)
      return dialogs.length === 1 ? dialogs[0] : null
    }, 2500)
    if (!dialog) {
      await dismissOverlays()
      return { ok: false, error: 'Delete confirmation did not appear' }
    }
    if (bridge.dialogDeletesConversation(text(dialog))) {
      await dismissOverlays()
      return { ok: false, error: 'refused a conversation delete confirmation' }
    }
    const buttons = qa(S.confirmButton, dialog).filter((el) => el.getClientRects().length > 0)
    const confirmLabel = String(bridge.pickConfirmLabel(buttons.map(labelOf)) || '')
    const confirm = buttons.filter((el) => labelOf(el).toLowerCase().replace(/\s+/g, ' ') === confirmLabel)
    if (!confirmLabel || confirm.length !== 1) {
      await dismissOverlays()
      return { ok: false, error: 'Delete confirmation button was not exact' }
    }
    if (!headerMatches(name) || !wrapper.isConnected) {
      await dismissOverlays()
      return { ok: false, error: 'conversation changed; stopped' }
    }
    if (!decoratePairs(scrapePairs()).some((pair) => pair.el === wrapper && pair.msg && pair.msg.id === id)) {
      await dismissOverlays()
      return { ok: false, error: 'message changed before confirm; not deleted' }
    }
    if (!(await trustedClick(confirm[0]))) {
      await dismissOverlays()
      return { ok: false, error: "couldn't press the Delete confirmation" }
    }
    const gone = await waitFor(() => {
      const dialogOpen = overlays(S.confirmDialog).length > 0
      const present = decoratePairs(scrapePairs()).some((pair) => pair.msg && pair.msg.id === id)
      return !dialogOpen && !present
    }, 4000)
    if (!gone) return { ok: false, error: 'message still there after delete', confirm: confirmLabel }
    return { ok: true, confirm: confirmLabel }
  }

  async function deleteNotes(p: { conversation?: string; ids?: unknown; texts?: unknown }): Promise<unknown> {
    const name = String(p.conversation || '')
    const title = await ensureConversation(name)
    const ids = Array.isArray(p.ids) ? p.ids.filter((id): id is string => typeof id === 'string' && !!id) : []
    const texts = Array.isArray(p.texts) ? p.texts.filter((value): value is string => typeof value === 'string' && !!value) : []
    let gathered = await gather(0, '', [])
    const missingId = ids.some((id) => !gathered.messages.some((msg) => msg && msg.id === id))
    if ((texts.length > 0 || missingId) && !gathered.complete) gathered = await gather(30, '', gathered.messages)
    if (!headerMatches(name)) fail('wrong-conversation')
    const plan = bridge.planDeletes(gathered.messages, ids, texts, gathered.complete)
    if (!Array.isArray(plan)) fail('plan')
    const results: Record<string, unknown>[] = []
    let stopped = false
    for (const item of plan) {
      const id = typeof item.id === 'string' ? item.id : undefined
      const textValue = typeof item.text === 'string' ? item.text : undefined
      if (stopped || !headerMatches(name)) {
        stopped = true
        results.push(resultItem({ id, text: textValue, ok: false, error: 'conversation changed; stopped' }))
        continue
      }
      if (item.action !== 'delete' || typeof item.targetId !== 'string') {
        results.push(resultItem({ id, text: textValue, ok: false, error: typeof item.error === 'string' ? item.error : 'not deleted' }))
        continue
      }
      const wrapper = await findWrapper(item.targetId)
      if (!headerMatches(name)) {
        stopped = true
        results.push(resultItem({ id: id || item.targetId, text: textValue, ok: false, error: 'conversation changed; stopped' }))
        continue
      }
      if (!wrapper) {
        results.push(resultItem({ id: id || item.targetId, text: textValue, ok: false, error: 'not found on screen' }))
        continue
      }
      const outcome = await deleteOne(name, wrapper, item.targetId)
      if (outcome.error === 'conversation changed; stopped') stopped = true
      console.info('[RexMessages] notes delete', item.targetId, outcome.ok ? 'ok' : outcome.error || 'failed')
      results.push(resultItem({
        id: id || item.targetId,
        text: textValue,
        ok: outcome.ok,
        error: outcome.error,
        confirm: outcome.confirm
      }))
    }
    return { conversation: title, results }
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
      case 'listNotes':
        return listNotes(payload)
      case 'deleteNotes':
        return deleteNotes(payload)
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
