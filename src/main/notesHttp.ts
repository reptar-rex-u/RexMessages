import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import {
  NotesHttpError,
  parseDeleteBody,
  parseListQuery,
  type DeleteRequest,
  type ListQuery,
  type NoteMessage
} from '../shared/notes'

export const NOTES_API_HOST = '127.0.0.1'

export interface ListResponse {
  conversation: string
  messages: NoteMessage[]
  mayHaveOlder: boolean
  cursorFound?: boolean
}

export interface DeleteResponseItem {
  id?: string
  text?: string
  ok: boolean
  error?: string
}

export interface DeleteResponse {
  conversation: string
  results: DeleteResponseItem[]
}

export interface NotesBackend {
  health(): { pageLoaded: boolean } | Promise<{ pageLoaded: boolean }>
  list(query: ListQuery): Promise<ListResponse>
  remove(request: DeleteRequest): Promise<DeleteResponse>
}

export function isLoopbackAddress(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::ffff:127.0.0.1'
}

export function isLocalHostHeader(host: string | undefined): boolean {
  if (!host) return false
  const trimmed = host.trim().toLowerCase()
  const name = trimmed.startsWith('[') ? trimmed.slice(1, trimmed.indexOf(']')) : trimmed.replace(/:\d+$/, '')
  return name === '127.0.0.1' || name === 'localhost'
}

export function bearerToken(header: string | undefined): string {
  if (!header) return ''
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header)
  return match ? match[1] : ''
}

export function tokenEquals(expected: string, presented: string): boolean {
  const a = Buffer.from(expected)
  const b = Buffer.from(presented)
  if (a.length === 0) return false
  if (a.length !== b.length) {
    timingSafeEqual(a, Buffer.alloc(a.length))
    return false
  }
  return timingSafeEqual(a, b)
}

// No CORS headers. Another local web page cannot read the response, and a
// JSON POST still needs the token.
function send(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  })
  res.end(data)
}

function readBody(req: IncomingMessage, limit = 65536): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    const onData = (chunk: Buffer): void => {
      size += chunk.length
      if (size > limit) {
        req.pause()
        req.off('data', onData)
        reject(new NotesHttpError(413, 'Body too large'))
        return
      }
      chunks.push(chunk)
    }
    req.on('data', onData)
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', () => reject(new NotesHttpError(400, 'Bad request')))
  })
}

export function createNotesServer(opts: {
  token: string
  port: number
  backend: NotesBackend
  log?: (line: string) => void
}): Server {
  const log = opts.log ?? (() => {})
  return createServer((req, res) => {
    void handle(req, res, opts, log).catch((err: unknown) => {
      if (res.headersSent || res.writableEnded) return
      const status = err instanceof NotesHttpError ? err.status : 500
      const error = err instanceof NotesHttpError ? err.message : 'Request failed'
      if (!(err instanceof NotesHttpError)) log(`request error ${err instanceof Error ? err.message : String(err)}`)
      send(res, status, { ok: false, error })
      req.destroy()
    })
  })
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  opts: { token: string; port: number; backend: NotesBackend },
  log: (line: string) => void
): Promise<void> {
  if (!isLoopbackAddress(req.socket.remoteAddress)) {
    send(res, 403, { ok: false, error: 'Forbidden' })
    return
  }
  if (!isLocalHostHeader(req.headers.host)) {
    send(res, 403, { ok: false, error: 'Forbidden' })
    return
  }
  const header = Array.isArray(req.headers.authorization) ? req.headers.authorization[0] : req.headers.authorization
  if (!tokenEquals(opts.token, bearerToken(header))) {
    log(`${req.method || 'GET'} auth failed`)
    send(res, 401, { ok: false, error: 'Unauthorized' })
    return
  }

  let url: URL
  try {
    url = new URL(req.url || '/', 'http://127.0.0.1')
  } catch {
    send(res, 400, { ok: false, error: 'Bad request' })
    return
  }
  const path = url.pathname.replace(/\/+$/, '') || '/'
  const method = req.method || 'GET'

  if (path === '/health' && method === 'GET') {
    const health = await opts.backend.health()
    send(res, 200, { ok: true, service: 'rexmessages', port: opts.port, pageLoaded: !!health.pageLoaded })
    return
  }

  if (path === '/notes' && method === 'GET') {
    const parsed = parseListQuery(url.searchParams)
    if (!parsed.ok) {
      send(res, 400, { ok: false, error: parsed.error })
      return
    }
    const data = await opts.backend.list(parsed.value)
    log(`GET /notes conversation=${JSON.stringify(parsed.value.conversation)} messages=${data.messages.length} 200`)
    const body: Record<string, unknown> = {
      ok: true,
      conversation: data.conversation,
      messages: data.messages,
      mayHaveOlder: data.mayHaveOlder
    }
    if (parsed.value.before) body.cursorFound = data.cursorFound !== false
    send(res, 200, body)
    return
  }

  if (path === '/notes/delete' && method === 'POST') {
    const type = String(req.headers['content-type'] || '')
    if (!/^application\/json\b/i.test(type)) {
      send(res, 400, { ok: false, error: 'Content-Type must be application/json' })
      return
    }
    const text = (await readBody(req)).trim()
    if (!text) {
      send(res, 400, { ok: false, error: 'Expected a JSON object' })
      return
    }
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      send(res, 400, { ok: false, error: 'Invalid JSON' })
      return
    }
    const parsed = parseDeleteBody(json)
    if (!parsed.ok) {
      send(res, 400, { ok: false, error: parsed.error })
      return
    }
    const data = await opts.backend.remove(parsed.value)
    const deleted = data.results.filter((item) => item.ok).length
    log(
      `POST /notes/delete conversation=${JSON.stringify(parsed.value.conversation)} deleted=${deleted} failed=${data.results.length - deleted} 200`
    )
    send(res, 200, { ok: true, conversation: data.conversation, results: data.results })
    return
  }

  if (path === '/health' || path === '/notes' || path === '/notes/delete') {
    send(res, 405, { ok: false, error: 'Method not allowed' })
    return
  }
  send(res, 404, { ok: false, error: 'Not found' })
}

// Bound to loopback only. There is no host argument on purpose.
export function listenNotesServer(server: Server, port: number): Promise<void> {
  if (port !== 0 && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    return Promise.reject(new Error('Invalid port'))
  }
  return new Promise((resolve, reject) => {
    const onError = (err: Error): void => {
      server.off('error', onError)
      reject(err)
    }
    server.once('error', onError)
    server.listen(port, NOTES_API_HOST, () => {
      server.off('error', onError)
      resolve()
    })
  })
}
