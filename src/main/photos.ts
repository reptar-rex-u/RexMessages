import {
  app,
  clipboard,
  ClipboardItem,
  dialog,
  ipcMain,
  nativeImage,
  shell,
  type BrowserWindow,
  type WebContents
} from 'electron'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { extname, join, parse } from 'node:path'
import type { SaveAllItem } from '../shared/types'

const tempDir = join(app.getPath('temp'), 'RexMessages')

const EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/bmp': '.bmp'
}

function decode(dataUrl: string): { mime: string; buf: Buffer } {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(String(dataUrl))
  if (!m) throw new Error('Not a data URL')
  const mime = m[1] || 'application/octet-stream'
  const buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]))
  return { mime, buf }
}

function safeName(name: string, mime: string): string {
  const cleaned = String(name || 'photo').replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'photo'
  const ext = EXT[mime] ?? '.jpg'
  return extname(cleaned) ? cleaned : cleaned + ext
}

function uniquePath(dir: string, file: string): string {
  let candidate = join(dir, file)
  const { name, ext } = parse(file)
  for (let i = 2; existsSync(candidate); i++) candidate = join(dir, `${name} (${i})${ext}`)
  return candidate
}

export function cleanupTemp(): void {
  try {
    rmSync(tempDir, { recursive: true, force: true })
  } catch {
    // Temp files can be locked by an open viewer; Windows cleans them later.
  }
}

export function registerPhotoIpc(
  allowed: (wc: WebContents) => boolean,
  owner: () => BrowserWindow | null
): void {
  ipcMain.handle('photo:saveAs', async (event, dataUrl: string, name: string) => {
    if (!allowed(event.sender)) return null
    const { mime, buf } = decode(dataUrl)
    const file = safeName(name, mime)
    const win = owner()
    const opts = {
      defaultPath: join(app.getPath('pictures'), file),
      filters: [{ name: 'Image', extensions: [extname(file).slice(1) || 'jpg'] }]
    }
    const result = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, buf)
    return result.filePath
  })

  ipcMain.handle('photo:copy', async (event, pngDataUrl: string) => {
    if (!allowed(event.sender)) return false
    const img = nativeImage.createFromDataURL(pngDataUrl)
    if (img.isEmpty()) return false
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(img.toPNG())], { type: 'image/png' }) })])
    return true
  })

  ipcMain.handle('photo:open', async (event, dataUrl: string, name: string) => {
    if (!allowed(event.sender)) return false
    const { mime, buf } = decode(dataUrl)
    mkdirSync(tempDir, { recursive: true })
    const file = uniquePath(tempDir, safeName(name, mime))
    await writeFile(file, buf)
    const err = await shell.openPath(file)
    return !err
  })

  ipcMain.handle('photo:showInFolder', (event, filePath: string) => {
    if (!allowed(event.sender) || !filePath || !existsSync(filePath)) return false
    shell.showItemInFolder(filePath)
    return true
  })

  ipcMain.handle('photo:saveAll', async (event, items: SaveAllItem[]) => {
    if (!allowed(event.sender) || !Array.isArray(items) || !items.length) return null
    const win = owner()
    const opts = {
      title: 'Choose a folder for the photos',
      defaultPath: app.getPath('pictures'),
      properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>
    }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    const folder = result.filePaths[0]
    if (result.canceled || !folder) return null
    let first = ''
    let count = 0
    for (const item of items) {
      try {
        const { mime, buf } = decode(item.dataUrl)
        const file = uniquePath(folder, safeName(item.name, mime))
        await writeFile(file, buf)
        if (!first) first = file
        count++
      } catch (err) {
        console.error('Failed to save photo', err)
      }
    }
    return { folder, first, count }
  })
}
