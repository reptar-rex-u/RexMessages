import { app, nativeImage, type NativeImage } from 'electron'
import { join } from 'node:path'

export const MESSAGES_URL = 'https://messages.google.com/web'
export const PARTITION = 'persist:messages'

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
