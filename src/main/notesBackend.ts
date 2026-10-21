import type { PageCommand } from '../shared/types'
import {
  NotesHttpError,
  sanitizeMessages,
  type DeleteRequest,
  type ListQuery,
  type NoteMessage
} from '../shared/notes'
import type { DeleteResponse, DeleteResponseItem, ListResponse } from './notesHttp'

export interface NotesRuntime {
  run(command: PageCommand, timeoutMs: number): Promise<unknown>
  pageLoaded(): boolean
  log(line: string): void
}

interface PageList {
  conversation?: unknown
  messages?: unknown
  mayHaveOlder?: unknown
  cursorFound?: unknown
}

interface PageDelete {
  conversation?: unknown
  results?: unknown
}

function fromPage(err: unknown, log: (line: string) => void): never {
  const message = err instanceof Error ? err.message : String(err)
  log(`page error ${message.replace(/[\r\n]/g, ' ').slice(0, 300)}`)
  if (message.includes('not loaded') || message.includes('still loading') || message.includes('did not respond')) {
    throw new NotesHttpError(503, 'Google Messages is not ready')
  }
  if (message.includes('notes:draft')) {
    throw new NotesHttpError(409, 'The open chat has an unsent draft, so it was left alone')
  }
  if (message.includes('notes:not-found-conversation')) throw new NotesHttpError(409, "Couldn't find that conversation")
  if (message.includes('notes:wrong-conversation')) {
    throw new NotesHttpError(409, 'The open conversation did not match, so nothing was changed')
  }
  if (message.includes('notes:no-message-list')) {
    throw new NotesHttpError(409, "Couldn't find the message list, so nothing was changed")
  }
  throw new NotesHttpError(500, 'Google Messages could not complete the request')
}

function listTimeout(query: ListQuery): number {
  const steps = Math.max(query.scroll, query.before ? 30 : query.scroll)
  return 25000 + steps * 4000
}

function publicResults(value: unknown): DeleteResponseItem[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    const raw = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
    const result: DeleteResponseItem = { ok: raw.ok === true }
    if (typeof raw.id === 'string' && raw.id) result.id = raw.id.slice(0, 200)
    if (typeof raw.text === 'string' && raw.text) result.text = raw.text.slice(0, 20000)
    if (!result.ok) result.error = typeof raw.error === 'string' && raw.error ? raw.error.slice(0, 300) : 'failed'
    return result
  })
}

export function createNotesBackend(deps: NotesRuntime): {
  health(): { pageLoaded: boolean }
  list(query: ListQuery): Promise<ListResponse>
  remove(request: DeleteRequest): Promise<DeleteResponse>
} {
  let chain: Promise<void> = Promise.resolve()
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn)
    chain = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  return {
    health: () => ({ pageLoaded: deps.pageLoaded() }),
    list: (query) =>
      exclusive(async () => {
        if (!query.conversation.trim()) throw new NotesHttpError(400, 'Missing conversation')
        if (!deps.pageLoaded()) throw new NotesHttpError(503, 'Google Messages is not ready')
        let page: PageList
        try {
          page = (await deps.run(
            {
              cmd: 'listNotes',
              payload: {
                conversation: query.conversation,
                scroll: query.scroll,
                limit: query.limit,
                before: query.before
              }
            },
            listTimeout(query)
          )) as PageList
        } catch (err) {
          throw fromPage(err, deps.log)
        }
        const messages: NoteMessage[] = sanitizeMessages(page.messages)
        deps.log(`listed conversation=${JSON.stringify(query.conversation)} messages=${messages.length}`)
        return {
          conversation: typeof page.conversation === 'string' && page.conversation ? page.conversation : query.conversation,
          messages,
          mayHaveOlder: page.mayHaveOlder === true,
          cursorFound: page.cursorFound !== false
        }
      }),
    remove: (request) =>
      exclusive(async () => {
        if (!request.conversation.trim()) throw new NotesHttpError(400, 'Missing conversation')
        if (!deps.pageLoaded()) throw new NotesHttpError(503, 'Google Messages is not ready')
        let page: PageDelete
        try {
          page = (await deps.run(
            {
              cmd: 'deleteNotes',
              payload: { conversation: request.conversation, ids: request.ids, texts: request.texts }
            },
            45000 + Math.max(1, request.ids.length + request.texts.length) * 20000
          )) as PageDelete
        } catch (err) {
          throw fromPage(err, deps.log)
        }
        const results = publicResults(page.results)
        deps.log(
          `deleted conversation=${JSON.stringify(request.conversation)} ${results
            .map((item) => `${item.ok ? 'ok' : 'fail'} ${item.error || item.id || 'text'}`)
            .join('; ')
            .slice(0, 500)}`
        )
        return {
          conversation: typeof page.conversation === 'string' && page.conversation ? page.conversation : request.conversation,
          results
        }
      })
  }
}
