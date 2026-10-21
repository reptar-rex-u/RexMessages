import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { PageCommand } from '../shared/types'
import {
  classifyMenu,
  decorateNotes,
  DEFAULT_CONVERSATION,
  dialogDeletesConversation,
  extractUrls,
  isMessageDeleteLabel,
  mergeNotes,
  noteId,
  NotesHttpError,
  pageNotes,
  parseDeleteBody,
  parseListQuery,
  parseMessageAria,
  parseTimestamp,
  pickConfirmLabel,
  planDeletes,
  resolveNotesPort,
  type NoteMessage
} from '../shared/notes'
import { createNotesBackend } from './notesBackend'
import {
  bearerToken,
  createNotesServer,
  isLocalHostHeader,
  isLoopbackAddress,
  listenNotesServer,
  NOTES_API_HOST,
  tokenEquals,
  type NotesBackend
} from './notesHttp'
import { readOrCreateToken } from './notesToken'

const TOKEN = 'a'.repeat(64)

function msg(id: string, text: string): NoteMessage {
  return { id, text, urls: [] }
}

test('extracts http urls and drops wrapping punctuation', () => {
  assert.deepEqual(extractUrls('see https://example.com/a.'), ['https://example.com/a'])
  assert.deepEqual(extractUrls('(https://example.com/a)'), ['https://example.com/a'])
  assert.deepEqual(extractUrls('https://en.wikipedia.org/wiki/Foo_(bar)'), ['https://en.wikipedia.org/wiki/Foo_(bar)'])
  assert.deepEqual(extractUrls('http://example.com and https://example.com/x and https://example.com/x'), [
    'http://example.com',
    'https://example.com/x'
  ])
  assert.deepEqual(extractUrls('not a url'), [])
})

test('parses an absolute message time and ignores a clock time alone', () => {
  const iso = parseTimestamp('Tuesday, October 20, 2026 at 3:41 PM')
  const date = new Date(iso)
  assert.equal(date.getFullYear(), 2026)
  assert.equal(date.getMonth(), 9)
  assert.equal(date.getDate(), 20)
  assert.equal(date.getHours(), 15)
  assert.equal(date.getMinutes(), 41)
  assert.equal(parseTimestamp('3:41 PM'), '')
  assert.equal(parseTimestamp('2026-10-20T19:41:00.000Z'), '2026-10-20T19:41:00.000Z')
})

test('reads the message aria label without swallowing the body', () => {
  const parsed = parseMessageAria(
    'You said: buy milk https://example.com/a. Sent on Tuesday, October 20, 2026 at 3:41 PM. Delivered.'
  )
  assert.equal(parsed?.sender, 'You')
  assert.equal(parsed?.content, 'buy milk https://example.com/a.')
  assert.match(parsed?.timeLabel || '', /October 20, 2026/)
  assert.ok(parsed?.timestamp)
  assert.equal(parseMessageAria('Just a label'), null)
})

test('note ids prefer a stable dom id and do not use position', () => {
  const first = noteId({ text: 'hello', timeLabel: 'October 20, 2026 3:41 PM' })
  const second = noteId({ text: 'hello', timeLabel: 'October 20, 2026 3:41 PM' })
  const other = noteId({ text: 'hello', timeLabel: 'October 21, 2026 3:41 PM' })
  assert.equal(first, second)
  assert.notEqual(first, other)
  assert.match(first, /^local:[0-9a-f]{16}$/)
  assert.equal(
    noteId({ domId: 'mws-message-wrapper-12', text: 'hello', timeLabel: '' }),
    noteId({ text: 'hello', timeLabel: '' })
  )
  assert.equal(noteId({ domId: 'abc123==', text: 'x', timeLabel: 't' }), 'dom:abc123==')
  assert.match(noteId({ domId: 'mws-abc12345', text: 'x', timeLabel: 't' }), /^local:/)
})

test('decorateNotes keeps urls from the text and the anchors', () => {
  const [note] = decorateNotes([
    {
      text: 'see https://example.com/a.',
      timeLabel: 'October 20, 2026 3:41 PM',
      timeCandidates: ['October 20, 2026 3:41 PM'],
      hrefs: ['https://example.com/b']
    }
  ])
  assert.equal(note?.text, 'see https://example.com/a.')
  assert.deepEqual(note?.urls, ['https://example.com/b', 'https://example.com/a'])
  assert.ok(note?.timestamp)
})

test('merge keeps oldest-to-newest order across scroll windows', () => {
  const older = [msg('a', 'a'), msg('b', 'b'), msg('c', 'c')]
  const newer = [msg('c', 'c'), msg('d', 'd')]
  assert.deepEqual(mergeNotes(newer, older).map((item) => item.id), ['a', 'b', 'c', 'd'])
  assert.deepEqual(mergeNotes([], newer).map((item) => item.id), ['c', 'd'])
  assert.deepEqual(mergeNotes(older, []).map((item) => item.id), ['a', 'b', 'c'])
})

test('pages newest first and walks older with before', () => {
  const all = ['a', 'b', 'c', 'd', 'e'].map((id) => msg(id, id))
  const first = pageNotes(all, { limit: 2, canScrollUp: false })
  assert.deepEqual(first.messages.map((item) => item.id), ['e', 'd'])
  assert.equal(first.mayHaveOlder, true)
  const next = pageNotes(all, { before: 'd', limit: 2, canScrollUp: false })
  assert.deepEqual(next.messages.map((item) => item.id), ['c', 'b'])
  assert.equal(next.cursorFound, true)
  const missing = pageNotes(all, { before: 'missing', limit: 2, canScrollUp: false })
  assert.equal(missing.cursorFound, false)
  assert.deepEqual(missing.messages, [])
})

test('menu and confirm choices stay on one message', () => {
  assert.equal(classifyMenu(['Copy', 'Delete']), 'message')
  assert.equal(classifyMenu(['Delete this message', 'Forward']), 'message')
  assert.equal(classifyMenu(['Move to trash']), 'conversation')
  assert.equal(classifyMenu(['Delete', 'Block']), 'conversation')
  assert.equal(classifyMenu(['Delete conversation']), 'conversation')
  assert.equal(classifyMenu([]), 'unknown')
  assert.equal(isMessageDeleteLabel('Delete'), true)
  assert.equal(isMessageDeleteLabel('Delete conversation'), false)
  assert.equal(dialogDeletesConversation('This message will be removed from the conversation.'), false)
  assert.equal(dialogDeletesConversation('Delete this conversation?'), true)
  assert.equal(dialogDeletesConversation('Move this conversation to trash?'), true)
  assert.equal(pickConfirmLabel(['Cancel', 'Delete']), 'delete')
  assert.equal(pickConfirmLabel(['Cancel', 'Delete for me', 'Delete for everyone']), 'delete for me')
  assert.equal(pickConfirmLabel(['Cancel', 'Delete for everyone']), 'delete for everyone')
  assert.equal(pickConfirmLabel(['Delete', 'Delete']), '')
})

test('delete planning is exact and refuses ambiguity', () => {
  const messages = [
    { id: '1', text: 'buy milk' },
    { id: '2', text: 'buy milk' },
    { id: '3', text: 'https://example.com/notes' }
  ]
  const byText = planDeletes(messages, [], ['buy milk'], true)
  assert.equal(byText[0].action, 'skip')
  assert.match(byText[0].error || '', /matched 2/)
  const substring = planDeletes(messages, [], ['milk'], true)
  assert.equal(substring[0].action, 'skip')
  assert.equal(substring[0].error, 'not found')
  const urlPiece = planDeletes(messages, [], ['example.com'], true)
  assert.equal(urlPiece[0].error, 'not found')
  const exact = planDeletes(messages, [], ['https://example.com/notes'], true)
  assert.deepEqual(exact[0], { text: 'https://example.com/notes', action: 'delete', targetId: '3' })
  const differentCase = planDeletes([{ id: '1', text: 'Buy milk' }], [], ['buy milk'], true)
  assert.equal(differentCase[0].error, 'not found')
  const hidden = planDeletes(messages, [], ['https://example.com/notes'], false)
  assert.match(hidden[0].error || '', /delete by id/)
  const byId = planDeletes(messages, ['3'], [], false)
  assert.equal(byId[0].action, 'delete')
  assert.equal(byId[0].targetId, '3')
  const missing = planDeletes(messages, ['nope'], [], true)
  assert.equal(missing[0].error, 'not found')
  const partial = planDeletes(messages, ['local:ab'], [], true)
  assert.equal(partial[0].error, 'not found')
})

test('query and delete bodies default to My Notes and reject bad input', () => {
  const list = parseListQuery(new URLSearchParams())
  assert.equal(list.ok && list.value.conversation, DEFAULT_CONVERSATION)
  assert.equal(list.ok && list.value.limit, 50)
  assert.equal(list.ok && list.value.scroll, 0)
  const mom = parseListQuery(new URLSearchParams('conversation=Mom'))
  assert.equal(mom.ok, true)
  if (mom.ok) assert.equal(mom.value.conversation, 'Mom')
  assert.equal(parseListQuery(new URLSearchParams('limit=0')).ok, false)
  assert.equal(parseListQuery(new URLSearchParams('scroll=31')).ok, false)
  const ids = parseDeleteBody({ ids: ['a'] })
  assert.equal(ids.ok && ids.value.conversation, 'My Notes')
  assert.deepEqual(ids.ok && ids.value.ids, ['a'])
  const text = parseDeleteBody({ text: 'hello', conversation: '  Mom  ' })
  assert.equal(text.ok && text.value.conversation, 'Mom')
  assert.deepEqual(text.ok && text.value.texts, ['hello'])
  assert.equal(parseDeleteBody({}).ok, false)
  assert.equal(parseDeleteBody({ ids: 'x' }).ok, false)
  assert.equal(parseDeleteBody({ text: '' }).ok, false)
  const dupes = parseDeleteBody({ ids: ['a', 'a'], texts: ['hi', 'hi'] })
  assert.deepEqual(dupes.ok && dupes.value.ids, ['a'])
  assert.deepEqual(dupes.ok && dupes.value.texts, ['hi'])
})

test('port 0 disables the API and a bad port falls back to 5190', () => {
  assert.deepEqual(resolveNotesPort(undefined), { port: 5190, fallback: false })
  assert.deepEqual(resolveNotesPort(0), { port: null, fallback: false })
  assert.deepEqual(resolveNotesPort('0'), { port: null, fallback: false })
  assert.deepEqual(resolveNotesPort(5191), { port: 5191, fallback: false })
  assert.deepEqual(resolveNotesPort('abc'), { port: 5190, fallback: true })
  assert.deepEqual(resolveNotesPort(70000), { port: 5190, fallback: true })
})

test('token compare does not throw on a different length', () => {
  assert.equal(tokenEquals(TOKEN, TOKEN), true)
  assert.equal(tokenEquals(TOKEN, `${TOKEN}x`), false)
  assert.equal(tokenEquals(TOKEN, 'short'), false)
  assert.equal(tokenEquals('', TOKEN), false)
  assert.equal(bearerToken('Bearer secret'), 'secret')
  assert.equal(bearerToken('Token secret'), '')
  assert.equal(NOTES_API_HOST, '127.0.0.1')
  assert.equal(isLoopbackAddress('127.0.0.1'), true)
  assert.equal(isLoopbackAddress('::1'), false)
  assert.equal(isLocalHostHeader('127.0.0.1:5190'), true)
  assert.equal(isLocalHostHeader('localhost'), true)
  assert.equal(isLocalHostHeader('evil.com'), false)
  assert.equal(isLocalHostHeader('127.0.0.1.evil.com'), false)
})

test('token file is created once and a bad file is left alone', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rexnotes-'))
  const file = join(dir, 'notes-api.token')
  const created = readOrCreateToken(file)
  assert.equal(created.created, true)
  assert.match(created.token, /^[a-f0-9]{64}$/)
  assert.equal((statSync(file).mode & 0o077) === 0, true)
  const again = readOrCreateToken(file)
  assert.equal(again.created, false)
  assert.equal(again.token, created.token)
  const bad = join(dir, 'bad.token')
  writeFileSync(bad, 'short\n')
  assert.throws(() => readOrCreateToken(bad), /not a usable token/)
  assert.equal(readFileSync(bad, 'utf8'), 'short\n')
})

async function withServer(backend: NotesBackend, fn: (base: string, port: number) => Promise<void>): Promise<void> {
  const server = createNotesServer({ token: TOKEN, port: 5190, backend, log: () => {} })
  await listenNotesServer(server, 0)
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('expected a loopback port')
  }
  assert.equal(address.address, NOTES_API_HOST)
  try {
    await fn(`http://127.0.0.1:${address.port}`, address.port)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
  }
}

function raw(
  port: number,
  path: string,
  headers: Record<string, string>,
  method = 'GET',
  body?: string
): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method, headers }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8'), headers: res.headers }))
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

test('HTTP API requires the token, stays on loopback, and defaults delete to My Notes', async () => {
  const calls: string[] = []
  const backend: NotesBackend = {
    health: () => ({ pageLoaded: true }),
    list: async (query) => {
      calls.push(`list:${query.conversation}:${query.limit}:${query.scroll}`)
      return {
        conversation: query.conversation,
        messages: [{ id: 'local:1', text: 'hi https://example.com', urls: ['https://example.com'] }],
        mayHaveOlder: false,
        cursorFound: true
      }
    },
    remove: async (req) => {
      calls.push(`delete:${req.conversation}:${req.ids.join(',')}:${req.texts.join('|')}`)
      return { conversation: req.conversation, results: [{ id: req.ids[0] || 'from-text', ok: true }] }
    }
  }
  await withServer(backend, async (base, port) => {
    const missing = await fetch(`${base}/health`)
    assert.equal(missing.status, 401)
    const wrong = await fetch(`${base}/health`, { headers: { Authorization: 'Bearer nope' } })
    assert.equal(wrong.status, 401)
    const health = await fetch(`${base}/health`, { headers: { Authorization: `Bearer ${TOKEN}` } })
    assert.equal(health.status, 200)
    assert.equal(health.headers.get('access-control-allow-origin'), null)
    assert.deepEqual(await health.json(), { ok: true, service: 'rexmessages', port: 5190, pageLoaded: true })

    const notes = await fetch(`${base}/notes`, { headers: { Authorization: `Bearer ${TOKEN}` } })
    assert.equal(notes.status, 200)
    const listed = await notes.json()
    assert.equal(listed.conversation, 'My Notes')
    assert.equal(listed.messages[0].id, 'local:1')

    const mom = await fetch(`${base}/notes?conversation=Mom&limit=10&scroll=2`, { headers: { Authorization: `Bearer ${TOKEN}` } })
    assert.equal(mom.status, 200)
    assert.equal(calls.includes('list:Mom:10:2'), true)

    const badLimit = await fetch(`${base}/notes?limit=0`, { headers: { Authorization: `Bearer ${TOKEN}` } })
    assert.equal(badLimit.status, 400)

    const deleted = await fetch(`${base}/notes/delete`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['local:1'] })
    })
    assert.equal(deleted.status, 200)
    assert.equal(calls.includes('delete:My Notes:local:1:'), true)

    const byText = await fetch(`${base}/notes/delete`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation: 'Mom', text: 'exact note' })
    })
    assert.equal((await byText.json()).conversation, 'Mom')
    assert.equal(calls.includes('delete:Mom::exact note'), true)

    const before = calls.length
    const denied = await fetch(`${base}/notes/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['local:1'] })
    })
    assert.equal(denied.status, 401)
    assert.equal(calls.length, before)

    const evil = await raw(port, '/health', { Host: 'evil.com', Authorization: `Bearer ${TOKEN}` })
    assert.equal(evil.status, 403)
    assert.equal(evil.headers['access-control-allow-origin'], undefined)

    const options = await raw(port, '/notes/delete', { Host: `127.0.0.1:${port}`, Authorization: `Bearer ${TOKEN}` }, 'OPTIONS')
    assert.equal(options.status, 405)
    assert.equal(options.headers['access-control-allow-origin'], undefined)

    const missingType = await raw(
      port,
      '/notes/delete',
      { Host: `127.0.0.1:${port}`, Authorization: `Bearer ${TOKEN}` },
      'POST',
      '{"ids":["x"]}'
    )
    assert.equal(missingType.status, 400)

    const badJson = await fetch(`${base}/notes/delete`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: '{"ids":'
    })
    assert.equal(badJson.status, 400)

    const notArray = await fetch(`${base}/notes/delete`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: 'x' })
    })
    assert.equal(notArray.status, 400)

    const unknown = await fetch(`${base}/nope`, { headers: { Authorization: `Bearer ${TOKEN}` } })
    assert.equal(unknown.status, 404)

    const huge = await fetch(`${base}/notes/delete`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: `{"text":"${'x'.repeat(70000)}"}`
    })
    assert.equal(huge.status, 413)
  })
  assert.equal(calls[0], 'list:My Notes:50:0')
})

test('backend passes the conversation through and strips confirm labels', async () => {
  const commands: PageCommand[] = []
  const backend = createNotesBackend({
    pageLoaded: () => true,
    log: () => {},
    run: async (command) => {
      commands.push(command)
      if (command.cmd === 'listNotes') {
        return {
          conversation: command.payload.conversation,
          messages: [{ id: 'local:1', text: 'hi', urls: ['https://example.com'], extra: 'no' }],
          mayHaveOlder: false,
          cursorFound: true
        }
      }
      if (command.cmd === 'deleteNotes') {
        return {
          conversation: command.payload.conversation,
          results: [{ id: command.payload.ids[0], text: 'secret note', ok: true, confirm: 'delete for me' }]
        }
      }
      throw new Error(`unexpected ${command.cmd}`)
    }
  })
  const listed = await backend.list({ conversation: 'My Notes', limit: 50, scroll: 0 })
  assert.deepEqual(listed.messages, [{ id: 'local:1', text: 'hi', urls: ['https://example.com'] }])
  const removed = await backend.remove({ conversation: 'Mom', ids: ['local:9'], texts: [] })
  assert.equal(removed.conversation, 'Mom')
  assert.deepEqual(removed.results, [{ id: 'local:9', text: 'secret note', ok: true }])
  assert.equal(commands[0].cmd, 'listNotes')
  assert.equal(commands[1].cmd, 'deleteNotes')
  if (commands[1].cmd === 'deleteNotes') assert.equal(commands[1].payload.conversation, 'Mom')
})

test('backend maps page failures and does not overlap commands', async () => {
  let called = false
  const offline = createNotesBackend({
    pageLoaded: () => false,
    log: () => {},
    run: async () => {
      called = true
      return {}
    }
  })
  await assert.rejects(
    () => offline.list({ conversation: 'My Notes', limit: 50, scroll: 0 }),
    (err: unknown) => err instanceof NotesHttpError && err.status === 503
  )
  assert.equal(called, false)

  const draft = createNotesBackend({
    pageLoaded: () => true,
    log: () => {},
    run: async () => {
      throw new Error('notes:draft')
    }
  })
  await assert.rejects(
    () => draft.remove({ conversation: 'My Notes', ids: ['x'], texts: [] }),
    (err: unknown) => err instanceof NotesHttpError && err.status === 409 && /draft/.test(err.message)
  )

  let active = 0
  let max = 0
  const busy = createNotesBackend({
    pageLoaded: () => true,
    log: () => {},
    run: async () => {
      active++
      max = Math.max(max, active)
      await new Promise((resolve) => setTimeout(resolve, 30))
      active--
      return { conversation: 'My Notes', messages: [], mayHaveOlder: false, cursorFound: true }
    }
  })
  await Promise.all([
    busy.list({ conversation: 'My Notes', limit: 10, scroll: 0 }),
    busy.list({ conversation: 'My Notes', limit: 10, scroll: 0 })
  ])
  assert.equal(max, 1)
})
