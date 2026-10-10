import { app, nativeImage, type NativeImage } from 'electron'
import { join } from 'node:path'

export const MESSAGES_URL = 'https://messages.google.com/web'
export const PAIRING_URL = 'https://messages.google.com/web/authentication'
export const PARTITION = 'persist:messages'

/** Plain /web never loads chats for account sign-in; it needs the /web/u/N/ slot. */
export function startUrl(accountPath: string): string {
  return /^\/web\/u\/\d+\/$/.test(accountPath) ? `https://messages.google.com${accountPath}conversations` : MESSAGES_URL
}

/** "/web/u/N/" while signed in with a Google account, "" once back on pairing, null otherwise. */
export function accountPathOf(url: string): string | null {
  try {
    const { hostname, pathname } = new URL(url)
    if (hostname !== 'messages.google.com') return null
    const slot = /^\/web\/u\/\d+\//.exec(pathname)
    if (slot) return slot[0]
    return /^\/web\/(welcome|authentication)/.test(pathname) ? '' : null
  } catch {
    return null
  }
}

const resourcesDir = app.isPackaged
  ? join(process.resourcesPath, 'resources')
  : join(app.getAppPath(), 'resources')

export function resource(...parts: string[]): string {
  return join(resourcesDir, ...parts)
}

export function image(...parts: string[]): NativeImage {
  return nativeImage.createFromPath(resource(...parts))
}

export function preload(name: 'inject' | 'popup' | 'gallery' | 'sw'): string {
  return join(__dirname, '../preload', `${name}.js`)
}

export function rendererUrl(page: 'popup' | 'gallery'): { url?: string; file?: string } {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) return { url: `${devUrl}/${page}/index.html` }
  return { file: join(__dirname, `../renderer/${page}/index.html`) }
}
