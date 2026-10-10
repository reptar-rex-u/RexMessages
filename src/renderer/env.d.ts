import type {
  GalleryPayload,
  IncomingMessage,
  PopupSettings,
  ReplyResult,
  SaveAllItem
} from '../shared/types'

declare global {
  interface PopupApi {
    onAdd(cb: (msg: IncomingMessage) => void): void
    onRemove(cb: (id: number) => void): void
    onSettings(cb: (s: PopupSettings) => void): void
    reply(id: number, sender: string, text: string): Promise<ReplyResult>
    open(id: number, sender: string): void
    resize(height: number): void
    empty(): void
  }

  interface GalleryApi {
    load(older: boolean): Promise<GalleryPayload>
    onRefresh(cb: () => void): void
    saveAs(dataUrl: string, name: string): Promise<string | null>
    copy(pngDataUrl: string): Promise<boolean>
    openExternal(dataUrl: string, name: string): Promise<boolean>
    showInFolder(path: string): Promise<boolean>
    saveAll(items: SaveAllItem[]): Promise<{ folder: string; first: string; count: number } | null>
  }

  interface Window {
    rex: PopupApi & GalleryApi
  }
}

export {}
