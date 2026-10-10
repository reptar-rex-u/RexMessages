// Type-only module: safe to import from main, preloads, and renderers.

export interface IncomingMessage {
  id: number
  sender: string
  body: string
  icon?: string
  tag?: string
  receivedAt: number
}

export interface ReplyResult {
  ok: boolean
  error?: string
}

export interface PagePhoto {
  dataUrl?: string
  url: string
  width: number
  height: number
}

export interface PagePhotoSet {
  conversation: string
  photos: PagePhoto[]
}

export interface GalleryPhoto {
  id: number
  dataUrl: string
  mime: string
  width: number
  height: number
}

export interface GalleryPayload {
  conversation: string
  photos: GalleryPhoto[]
  error?: string
}

export interface SaveAllItem {
  dataUrl: string
  name: string
}

export interface PopupSettings {
  sound: boolean
  popupSeconds: number
}

export type PageCommand =
  | { cmd: 'reply'; payload: { id: number; sender: string; text: string } }
  | { cmd: 'open'; payload: { id: number; sender: string } }
  | { cmd: 'collectPhotos'; payload: { older: boolean } }
