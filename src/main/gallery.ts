import { BrowserWindow, ipcMain, session } from 'electron'
import type { GalleryPayload, GalleryPhoto, PagePhotoSet } from '../shared/types'
import { runPageCommand } from './page'
import { PARTITION, preload, rendererUrl, resource } from './paths'
import { registerPhotoIpc } from './photos'

let gallery: BrowserWindow | null = null

function mimeOf(dataUrl: string): string {
  return /^data:([^;,]+)/.exec(dataUrl)?.[1] ?? 'image/png'
}

async function fetchAsDataUrl(url: string): Promise<string | undefined> {
  if (!/^https:/.test(url)) return undefined
  try {
    const res = await session.fromPartition(PARTITION).fetch(url)
    if (!res.ok) return undefined
    const type = res.headers.get('content-type')?.split(';')[0] || 'image/jpeg'
    const buf = Buffer.from(await res.arrayBuffer())
    return `data:${type};base64,${buf.toString('base64')}`
  } catch {
    return undefined
  }
}

async function collect(older: boolean): Promise<GalleryPayload> {
  try {
    const set = await runPageCommand<PagePhotoSet>({ cmd: 'collectPhotos', payload: { older } }, 90000)
    const photos: GalleryPhoto[] = []
    let id = 1
    for (const p of set.photos) {
      const dataUrl = p.dataUrl || (await fetchAsDataUrl(p.url))
      if (!dataUrl) continue
      photos.push({ id: id++, dataUrl, mime: mimeOf(dataUrl), width: p.width, height: p.height })
    }
    return { conversation: set.conversation, photos }
  } catch (err) {
    return { conversation: '', photos: [], error: err instanceof Error ? err.message : String(err) }
  }
}

export function openGallery(): void {
  if (gallery && !gallery.isDestroyed()) {
    if (gallery.isMinimized()) gallery.restore()
    gallery.show()
    gallery.focus()
    gallery.webContents.send('gallery:refresh')
    return
  }
  gallery = new BrowserWindow({
    width: 1040,
    height: 740,
    minWidth: 520,
    minHeight: 400,
    title: 'RexMessages - Photos',
    icon: resource('icon.ico'),
    backgroundColor: '#15171c',
    autoHideMenuBar: true,
    webPreferences: {
      preload: preload('gallery'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  gallery.setMenu(null)
  gallery.on('closed', () => {
    gallery = null
  })
  const target = rendererUrl('gallery')
  if (target.url) void gallery.loadURL(target.url)
  else void gallery.loadFile(target.file!)
}

export function getGalleryWindow(): BrowserWindow | null {
  return gallery && !gallery.isDestroyed() ? gallery : null
}

ipcMain.handle('gallery:load', (event, older: boolean) => {
  if (!gallery || event.sender !== gallery.webContents) {
    return { conversation: '', photos: [], error: 'Not allowed' } satisfies GalleryPayload
  }
  return collect(!!older)
})

registerPhotoIpc((wc) => !!gallery && !gallery.isDestroyed() && wc === gallery.webContents, getGalleryWindow)
