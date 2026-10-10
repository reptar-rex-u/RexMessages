import { contextBridge, ipcRenderer } from 'electron'
import type { GalleryPayload, SaveAllItem } from '../shared/types'

contextBridge.exposeInMainWorld('rex', {
  load: (older: boolean): Promise<GalleryPayload> => ipcRenderer.invoke('gallery:load', older),
  onRefresh: (cb: () => void) => ipcRenderer.on('gallery:refresh', () => cb()),
  saveAs: (dataUrl: string, name: string) => ipcRenderer.invoke('photo:saveAs', dataUrl, name),
  copy: (pngDataUrl: string) => ipcRenderer.invoke('photo:copy', pngDataUrl),
  openExternal: (dataUrl: string, name: string) => ipcRenderer.invoke('photo:open', dataUrl, name),
  showInFolder: (path: string) => ipcRenderer.invoke('photo:showInFolder', path),
  saveAll: (items: SaveAllItem[]) => ipcRenderer.invoke('photo:saveAll', items)
})
