import type { IncomingMessage, PopupSettings } from '../../shared/types'

const MAX_CARDS = 4
const TICK_MS = 250

type CardState = 'idle' | 'sending' | 'sent' | 'error'

interface Card {
  msg: IncomingMessage
  el: HTMLElement
  input: HTMLTextAreaElement
  status: HTMLElement
  sendBtn: HTMLButtonElement
  remaining: number
  state: CardState
}

const stack = document.getElementById('stack')!
const cards = new Map<number, Card>()
let settings: PopupSettings = { sound: true, popupSeconds: 8 }
let hovering = false
let audio: AudioContext | null = null

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, textContent?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (textContent !== undefined) node.textContent = textContent
  return node
}

function chime(): void {
  if (!settings.sound) return
  try {
    audio ??= new AudioContext()
    const now = audio.currentTime
    for (const [i, freq] of [880, 1320].entries()) {
      const osc = audio.createOscillator()
      const gain = audio.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const start = now + i * 0.12
      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(0.18, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35)
      osc.connect(gain).connect(audio.destination)
      osc.start(start)
      osc.stop(start + 0.4)
    }
  } catch {
    // Audio is optional.
  }
}

function avatar(msg: IncomingMessage): HTMLElement {
  if (msg.icon) {
    const img = el('img', 'avatar')
    img.src = msg.icon
    img.alt = ''
    img.onerror = () => img.replaceWith(initials(msg.sender))
    return img
  }
  return initials(msg.sender)
}

function initials(name: string): HTMLElement {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
  return el('div', 'avatar initials', letters || '?')
}

function time(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function report(): void {
  requestAnimationFrame(() => {
    if (!cards.size) {
      window.rex.empty()
      return
    }
    window.rex.resize(Math.ceil(stack.getBoundingClientRect().height))
  })
}

function removeCard(id: number): void {
  const card = cards.get(id)
  if (!card) return
  cards.delete(id)
  card.el.classList.add('leaving')
  setTimeout(() => {
    card.el.remove()
    report()
  }, 160)
}

function isBusy(card: Card): boolean {
  return card.state === 'sending' || document.activeElement === card.input || card.input.value.trim() !== ''
}

async function send(card: Card): Promise<void> {
  const text = card.input.value.trim()
  if (!text || card.state === 'sending') return
  card.state = 'sending'
  card.el.dataset.state = 'sending'
  card.input.disabled = true
  card.sendBtn.disabled = true
  card.status.textContent = 'Sending...'
  report()

  const result = await window.rex.reply(card.msg.id, card.msg.sender, text)
  if (result.ok) {
    card.state = 'sent'
    card.el.dataset.state = 'sent'
    card.status.textContent = 'Sent'
    setTimeout(() => removeCard(card.msg.id), 1200)
  } else {
    card.state = 'error'
    card.el.dataset.state = 'error'
    card.input.disabled = false
    card.sendBtn.disabled = false
    card.status.textContent = result.error || 'Could not send'
    card.remaining = Math.max(card.remaining, 20000)
  }
  report()
}

function openChat(card: Card): void {
  window.rex.open(card.msg.id, card.msg.sender)
  removeCard(card.msg.id)
}

function addCard(msg: IncomingMessage): void {
  if (msg.tag) {
    for (const [id, existing] of cards) {
      if (existing.msg.tag === msg.tag && !isBusy(existing)) removeCard(id)
    }
  }

  const root = el('div', 'card')
  root.dataset.state = 'idle'

  const head = el('div', 'head')
  const who = el('div', 'who')
  who.append(el('div', 'sender', msg.sender), el('div', 'time', time(msg.receivedAt)))
  const close = el('button', 'icon-btn close', '\u2715')
  close.title = 'Dismiss (Esc)'
  head.append(avatar(msg), who, close)

  const body = el('div', 'body', msg.body || '(no preview)')
  body.title = 'Open this chat'

  const row = el('div', 'reply')
  const input = el('textarea', 'input')
  input.rows = 1
  input.placeholder = 'Quick reply...'
  input.spellcheck = true
  const sendBtn = el('button', 'send', 'Send')
  row.append(input, sendBtn)

  const footer = el('div', 'footer')
  const status = el('div', 'status')
  const openBtn = el('button', 'link', 'Open chat')
  footer.append(status, openBtn)

  root.append(head, body, row, footer)

  const card: Card = { msg, el: root, input, status, sendBtn, remaining: settings.popupSeconds * 1000, state: 'idle' }
  cards.set(msg.id, card)

  close.onclick = () => removeCard(msg.id)
  body.onclick = () => openChat(card)
  openBtn.onclick = () => openChat(card)
  sendBtn.onclick = () => void send(card)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send(card)
    } else if (e.key === 'Escape') {
      removeCard(msg.id)
    }
  })
  input.addEventListener('input', () => {
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, 96)}px`
    report()
  })

  stack.prepend(root)
  while (cards.size > MAX_CARDS) {
    const oldest = [...cards.values()].find((c) => !isBusy(c))
    if (!oldest) break
    removeCard(oldest.msg.id)
  }
  chime()
  report()
}

setInterval(() => {
  if (hovering) return
  for (const card of cards.values()) {
    if (card.state === 'sent' || isBusy(card)) continue
    card.remaining -= TICK_MS
    if (card.remaining <= 0) removeCard(card.msg.id)
  }
}, TICK_MS)

document.addEventListener('mouseenter', () => (hovering = true))
document.addEventListener('mouseleave', () => (hovering = false))
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.activeElement === document.body) {
    const first = cards.keys().next()
    if (!first.done) removeCard(first.value)
  }
})

window.rex.onSettings((s) => {
  settings = s
})
window.rex.onAdd(addCard)
window.rex.onRemove((id) => {
  const card = cards.get(id)
  if (card && card.state === 'idle' && !isBusy(card)) removeCard(id)
})
