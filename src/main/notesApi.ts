import { app } from 'electron'
import { appendFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { join } from 'node:path'
import { resolveNotesPort } from '../shared/notes'
import { createNotesBackend } from './notesBackend'
import { createNotesServer, listenNotesServer } from './notesHttp'
import { readOrCreateToken } from './notesToken'
import { isPageLoaded, runPageCommand } from './page'
import { getSettings } from './store'

function log(line: string): void {
  const text = `${new Date().toISOString()} ${line.replace(/[\r\n]/g, ' ').slice(0, 500)}\n`
  console.log(`[RexMessages] ${line}`)
  try {
    appendFileSync(join(app.getPath('userData'), 'notes-api.log'), text)
  } catch {
    // Logging is best-effort.
  }
}

let server: Server | null = null
let starting: Server | null = null

export function startNotesApi(): void {
  if (server || starting) return
  const resolved = resolveNotesPort(getSettings().notesApiPort)
  if (resolved.fallback) log(`notesApiPort is invalid; using ${resolved.port}`)
  if (resolved.port === null) {
    log('notes API is off (notesApiPort is 0)')
    return
  }
  const port = resolved.port
  let token: string
  try {
    const file = join(app.getPath('userData'), 'notes-api.token')
    const read = readOrCreateToken(file)
    token = read.token
    if (read.created) log(`created notes API token at ${file}`)
  } catch (err) {
    log(`notes API did not start: ${err instanceof Error ? err.message : String(err)}`)
    return
  }
  const backend = createNotesBackend({
    pageLoaded: isPageLoaded,
    log,
    run: (command, timeoutMs) => runPageCommand(command, timeoutMs)
  })
  const httpServer = createNotesServer({ token, port, backend, log })
  starting = httpServer
  listenNotesServer(httpServer, port)
    .then(() => {
      if (starting !== httpServer) {
        httpServer.close()
        return
      }
      starting = null
      server = httpServer
      log(`notes API listening on 127.0.0.1:${port}`)
    })
    .catch((err: unknown) => {
      if (starting === httpServer) starting = null
      log(`notes API failed to listen on 127.0.0.1:${port}: ${err instanceof Error ? err.message : String(err)}`)
      httpServer.close()
    })
}

export function stopNotesApi(): void {
  const current = server || starting
  server = null
  starting = null
  current?.close()
}
