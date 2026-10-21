// Pure notes-API helpers. The Google page calls these through the preload
// bridge so message ids, URL picking, and delete decisions stay in one place.

export const DEFAULT_CONVERSATION = 'My Notes'
export const DEFAULT_NOTES_PORT = 5190

export class NotesHttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'NotesHttpError'
    this.status = status
  }
}

export interface NoteMessage {
  id: string
  text: string
  urls: string[]
  timestamp?: string
  timeLabel?: string
}

export interface RawNoteInput {
  domId?: string
  text?: string
  timeLabel?: string
  timeCandidates?: string[]
  hrefs?: string[]
}

export interface NoteRef {
  id: string
  text: string
}

export interface DeletePlanItem {
  id?: string
  text?: string
  action: 'delete' | 'skip'
  targetId?: string
  error?: string
}

export interface ListQuery {
  conversation: string
  limit: number
  scroll: number
  before?: string
}

export interface DeleteRequest {
  conversation: string
  ids: string[]
  texts: string[]
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

const FNV_OFFSET = 0xcbf29ce484222325n
const FNV_PRIME = 0x100000001b3n
const FNV_MASK = 0xffffffffffffffffn
const URL_RE = /https?:\/\/[^\s<>"'`]+/gi

export function fnv1a64(value: string): string {
  let hash = FNV_OFFSET
  for (let i = 0; i < value.length; i++) {
    hash ^= BigInt(value.charCodeAt(i))
    hash = (hash * FNV_PRIME) & FNV_MASK
  }
  return hash.toString(16).padStart(16, '0')
}

// Angular element ids (mws-message-wrapper-12) change every render. Only a
// long opaque attribute is stable enough to delete by.
export function isStableDomId(id: string): boolean {
  if (id.length < 8 || id.length > 200) return false
  if (!/^[A-Za-z0-9:._~+/=-]+$/.test(id)) return false
  if (/^(mws-|cdk-|mat-|ng-|message)/i.test(id)) return false
  if (/wrapper|conversation|menu|button/i.test(id)) return false
  return true
}

// No positional ordinal: loading older copies of the same text would renumber
// them and could make an id point at a different message. Identical text with
// the same time label shares an id, and delete refuses that as ambiguous.
export function noteId(parts: { domId?: string; text: string; timeLabel: string }): string {
  const domId = parts.domId?.trim() ?? ''
  if (domId && isStableDomId(domId)) return `dom:${domId}`
  return `local:${fnv1a64(`${parts.text}\0${parts.timeLabel}`)}`
}

export function cleanUrl(raw: string): string {
  let url = raw.trim().replace(/[.,;:!?]+$/g, '')
  const unmatched = (open: string, close: string): boolean => {
    const opens = url.split(open).length - 1
    const closes = url.split(close).length - 1
    return closes > opens
  }
  for (;;) {
    const last = url.at(-1)
    if (last === ')' && unmatched('(', ')')) url = url.slice(0, -1)
    else if (last === ']' && unmatched('[', ']')) url = url.slice(0, -1)
    else if (last === '}' && unmatched('{', '}')) url = url.slice(0, -1)
    else break
  }
  return url
}

export function extractUrls(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const match of text.matchAll(URL_RE)) {
    const url = cleanUrl(match[0])
    if (!url || seen.has(url)) continue
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue
    } catch {
      continue
    }
    seen.add(url)
    out.push(url)
  }
  return out
}

export function mergeUrls(text: string, hrefs: string[]): string[] {
  const hrefText = hrefs.filter((href) => typeof href === 'string').join('\n')
  return extractUrls(`${hrefText}\n${text}`).slice(0, 20)
}

export function parseTimestamp(raw: string): string {
  const original = raw.trim()
  if (!original || !/\d{4}/.test(original)) return ''
  const cleaned = original.replace(/\s+at\s+/gi, ' ').replace(/\s+/g, ' ').replace(/\.$/, '')
  const date = new Date(cleaned)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString()
}

const ARIA_RE =
  /^(?<sender>.+?) said:\s*(?<content>[\s\S]*?)\s+(?:Sent|Received) on (?<date>.+?) at (?<time>\d{1,2}:\d{2}(?::\d{2})?\s*[AP]M)\b/i

export function parseMessageAria(label: string): { sender: string; content: string; timeLabel: string; timestamp: string } | null {
  const match = label.trim().match(ARIA_RE)
  if (!match?.groups) return null
  const date = match.groups.date.trim().replace(/[.,]+$/g, '')
  const time = match.groups.time.trim()
  const timeLabel = `${date} ${time}`.replace(/\s+/g, ' ')
  return {
    sender: match.groups.sender.trim(),
    content: match.groups.content.trim(),
    timeLabel,
    timestamp: parseTimestamp(timeLabel)
  }
}

function asString(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

export function decorateNote(input: RawNoteInput): NoteMessage | null {
  const text = asString(input.text, 50000).trim()
  if (!text) return null
  const timeLabel = asString(input.timeLabel, 200).trim()
  const candidates = Array.isArray(input.timeCandidates) ? input.timeCandidates : []
  const timestamp = candidates.map((candidate) => parseTimestamp(asString(candidate, 300))).find(Boolean) || ''
  const hrefs = Array.isArray(input.hrefs) ? input.hrefs.filter((href): href is string => typeof href === 'string') : []
  const msg: NoteMessage = {
    id: noteId({ domId: asString(input.domId, 200), text, timeLabel }),
    text,
    urls: mergeUrls(text, hrefs)
  }
  if (timeLabel) msg.timeLabel = timeLabel
  if (timestamp) msg.timestamp = timestamp
  return msg
}

export function decorateNotes(inputs: unknown): NoteMessage[] {
  if (!Array.isArray(inputs)) return []
  const out: NoteMessage[] = []
  for (const input of inputs) {
    if (!input || typeof input !== 'object') continue
    const msg = decorateNote(input as RawNoteInput)
    if (msg) out.push(msg)
  }
  return out
}

export function sanitizeMessage(value: unknown): NoteMessage | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== 'string' || !raw.id || typeof raw.text !== 'string') return null
  const urls = Array.isArray(raw.urls)
    ? raw.urls.filter((url): url is string => typeof url === 'string' && /^https?:\/\//i.test(url)).slice(0, 20)
    : []
  const msg: NoteMessage = { id: raw.id.slice(0, 200), text: raw.text.slice(0, 50000), urls }
  if (typeof raw.timestamp === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(raw.timestamp)) msg.timestamp = raw.timestamp.slice(0, 40)
  if (typeof raw.timeLabel === 'string' && raw.timeLabel.trim()) msg.timeLabel = raw.timeLabel.trim().slice(0, 200)
  return msg
}

export function sanitizeMessages(value: unknown): NoteMessage[] {
  if (!Array.isArray(value)) return []
  return value.map(sanitizeMessage).filter((msg): msg is NoteMessage => !!msg)
}

export function mergeNotes(acc: NoteMessage[], visible: NoteMessage[]): NoteMessage[] {
  if (!visible.length) return acc.slice()
  if (!acc.length) return visible.slice()
  const index = new Map(acc.map((msg, i) => [msg.id, i]))
  let anchor = -1
  let anchorVis = -1
  for (let i = 0; i < visible.length; i++) {
    const at = index.get(visible[i].id)
    if (at !== undefined) {
      anchor = at
      anchorVis = i
      break
    }
  }
  if (anchor === -1) {
    const seen = new Set(visible.map((msg) => msg.id))
    return visible.concat(acc.filter((msg) => !seen.has(msg.id)))
  }
  const older = visible.slice(0, anchorVis).filter((msg) => !index.has(msg.id))
  const next = acc.slice()
  next.splice(anchor, 0, ...older)
  const known = new Set(next.map((msg) => msg.id))
  next.push(...visible.slice(anchorVis + 1).filter((msg) => !known.has(msg.id)))
  return next
}

export function pageNotes(
  allOldestFirst: NoteMessage[],
  opts: { before?: string; limit: number; canScrollUp: boolean }
): { messages: NoteMessage[]; mayHaveOlder: boolean; cursorFound: boolean } {
  const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? Math.min(opts.limit, 200) : 50
  const before = opts.before?.trim() ?? ''
  let end = allOldestFirst.length
  if (before) {
    const idx = allOldestFirst.findIndex((msg) => msg.id === before)
    if (idx < 0) return { messages: [], mayHaveOlder: true, cursorFound: false }
    end = idx
  }
  const start = Math.max(0, end - limit)
  return {
    messages: allOldestFirst.slice(start, end).reverse(),
    mayHaveOlder: start > 0 || opts.canScrollUp,
    cursorFound: true
  }
}

function normLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, ' ')
}

const CONVERSATION_MENU = new Set([
  'delete conversation',
  'delete this conversation',
  'move to trash',
  'block',
  'mute',
  'archive',
  'mark as unread',
  'report spam'
])

export function isMessageDeleteLabel(label: string): boolean {
  const name = normLabel(label)
  return name === 'delete' || name === 'delete message' || name === 'delete this message'
}

export function classifyMenu(labels: string[]): 'message' | 'conversation' | 'unknown' {
  const names = labels.map(normLabel).filter(Boolean)
  if (names.some((name) => CONVERSATION_MENU.has(name))) return 'conversation'
  const deletes = names.filter((name) => isMessageDeleteLabel(name))
  if (deletes.length !== 1) return 'unknown'
  return 'message'
}

export function dialogDeletesConversation(dialogText: string): boolean {
  const text = dialogText.toLowerCase().replace(/\s+/g, ' ')
  if (/delete (this |the )?conversation\b/.test(text)) return true
  if (/conversation will be deleted/.test(text)) return true
  if (/delete (this |the )?chat\b/.test(text)) return true
  if (/move (this |the )?(conversation|chat) to trash/.test(text)) return true
  return false
}

export function pickConfirmLabel(labels: string[]): string {
  const names = labels.map(normLabel)
  const count = (name: string): number => names.filter((item) => item === name).length
  const plain = count('delete') + count('delete this message') + count('delete message')
  if (plain > 1 || count('delete for me') > 1 || count('delete for everyone') > 1) return ''
  if (count('delete') === 1) return 'delete'
  if (count('delete this message') === 1) return 'delete this message'
  if (count('delete message') === 1) return 'delete message'
  if (count('delete for me') === 1) return 'delete for me'
  if (plain === 0 && count('delete for me') === 0 && count('delete for everyone') === 1) return 'delete for everyone'
  return ''
}

// Full-string equality only. A substring such as "milk" never matches "buy milk".
export function planDeletes(messages: NoteRef[], ids: string[], texts: string[], historyComplete: boolean): DeletePlanItem[] {
  const plan: DeletePlanItem[] = []
  for (const id of ids) {
    const hits = messages.filter((msg) => msg.id === id)
    if (hits.length === 1) plan.push({ id, action: 'delete', targetId: hits[0].id })
    else if (hits.length === 0) plan.push({ id, action: 'skip', error: historyComplete ? 'not found' : 'not found in the loaded history' })
    else plan.push({ id, action: 'skip', error: 'ambiguous id' })
  }
  for (const text of texts) {
    if (!historyComplete) {
      plan.push({ text, action: 'skip', error: 'not the whole conversation is loaded; delete by id' })
      continue
    }
    const hits = messages.filter((msg) => msg.text === text)
    if (hits.length === 1) plan.push({ text, action: 'delete', targetId: hits[0].id })
    else if (hits.length === 0) plan.push({ text, action: 'skip', error: 'not found' })
    else plan.push({ text, action: 'skip', error: `matched ${hits.length} messages; delete by id` })
  }
  return plan
}

function parseBoundedInt(raw: string | null, fallback: number, min: number, max: number, name: string): Parsed<number> {
  if (raw === null || raw === '') return { ok: true, value: fallback }
  if (!/^\d+$/.test(raw)) return { ok: false, error: `${name} must be an integer from ${min} to ${max}` }
  const value = Number(raw)
  if (!Number.isInteger(value) || value < min || value > max) {
    return { ok: false, error: `${name} must be an integer from ${min} to ${max}` }
  }
  return { ok: true, value }
}

export function parseListQuery(params: URLSearchParams): Parsed<ListQuery> {
  const conversation = (params.get('conversation') ?? DEFAULT_CONVERSATION).trim() || DEFAULT_CONVERSATION
  if (conversation.length > 200) return { ok: false, error: 'conversation name is too long' }
  const limit = parseBoundedInt(params.get('limit'), 50, 1, 200, 'limit')
  if (!limit.ok) return limit
  const scroll = parseBoundedInt(params.get('scroll'), 0, 0, 30, 'scroll')
  if (!scroll.ok) return scroll
  const before = params.get('before')?.trim() ?? ''
  if (before.length > 200) return { ok: false, error: 'before is too long' }
  const query: ListQuery = { conversation, limit: limit.value, scroll: scroll.value }
  if (before) query.before = before
  return { ok: true, value: query }
}

function readStrings(value: unknown, name: string, max: number, maxLen: number): Parsed<string[]> {
  if (value === undefined) return { ok: true, value: [] }
  if (!Array.isArray(value)) return { ok: false, error: `${name} must be an array of strings` }
  if (value.length > max) return { ok: false, error: `too many ${name}` }
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0) return { ok: false, error: `${name} must be non-empty strings` }
    if (item.length > maxLen) return { ok: false, error: `${name} entry is too long` }
    out.push(item)
  }
  return { ok: true, value: out }
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of items) {
    if (seen.has(item)) continue
    seen.add(item)
    out.push(item)
  }
  return out
}

export function parseDeleteBody(raw: unknown): Parsed<DeleteRequest> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Expected a JSON object' }
  const body = raw as Record<string, unknown>
  if (body.conversation !== undefined && typeof body.conversation !== 'string') {
    return { ok: false, error: 'conversation must be a string' }
  }
  const conversation =
    (typeof body.conversation === 'string' ? body.conversation.trim() : '') || DEFAULT_CONVERSATION
  if (conversation.length > 200) return { ok: false, error: 'conversation name is too long' }
  const ids = readStrings(body.ids, 'ids', 30, 200)
  if (!ids.ok) return ids
  const texts: string[] = []
  if (body.text !== undefined) {
    if (typeof body.text !== 'string') return { ok: false, error: 'text must be a string' }
    if (!body.text) return { ok: false, error: 'text must not be empty' }
    if (body.text.length > 20000) return { ok: false, error: 'text is too long' }
    texts.push(body.text)
  }
  if (body.texts !== undefined) {
    const more = readStrings(body.texts, 'texts', 30, 20000)
    if (!more.ok) return more
    texts.push(...more.value)
  }
  const uniqueTexts = dedupe(texts)
  if (uniqueTexts.length > 30) return { ok: false, error: 'too many texts' }
  const uniqueIds = dedupe(ids.value)
  if (!uniqueIds.length && !uniqueTexts.length) return { ok: false, error: 'Provide ids or text' }
  return { ok: true, value: { conversation, ids: uniqueIds, texts: uniqueTexts } }
}

// 0 turns the API off. Anything else invalid falls back to the default port.
export function resolveNotesPort(raw: unknown): { port: number | null; fallback: boolean } {
  if (raw === 0 || raw === '0') return { port: null, fallback: false }
  if (raw === undefined || raw === null || raw === '') return { port: DEFAULT_NOTES_PORT, fallback: false }
  const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : ''
  if (!/^\d+$/.test(text)) return { port: DEFAULT_NOTES_PORT, fallback: true }
  const port = Number(text)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { port: DEFAULT_NOTES_PORT, fallback: true }
  return { port, fallback: false }
}
