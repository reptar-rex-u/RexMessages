import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const TOKEN_RE = /^[A-Za-z0-9_-]{24,128}$/

export function readOrCreateToken(file: string): { token: string; created: boolean } {
  let existing = ''
  try {
    existing = readFileSync(file, 'utf8').trim()
  } catch {
    existing = ''
  }
  if (existing) {
    if (!TOKEN_RE.test(existing)) throw new Error('notes-api.token is not a usable token')
    return { token: existing, created: false }
  }
  const token = randomBytes(32).toString('hex')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${token}\n`, { encoding: 'utf8', mode: 0o600 })
  return { token, created: true }
}
