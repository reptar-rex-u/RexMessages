import type { GalleryPhoto } from '../../shared/types'

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T

const titleEl = $('title')
const countEl = $('count')
const stateEl = $('state')
const grid = $('grid')
const viewer = $('viewer')
const stage = $('stage')
const vImg = $<HTMLImageElement>('vImg')
const vIndex = $('vIndex')
const vZoom = $('vZoom')
const vFolder = $<HTMLButtonElement>('vFolder')
const toastEl = $('toast')
const buttons = {
  refresh: $<HTMLButtonElement>('refresh'),
  older: $<HTMLButtonElement>('older'),
  saveAll: $<HTMLButtonElement>('saveAll')
}

let conversation = ''
let photos: GalleryPhoto[] = []
const rotation = new Map<number, number>()
const savedPaths = new Map<number, string>()
let current = -1
let zoom = 1
let panX = 0
let panY = 0
let loading = false
let toastTimer: number | undefined

function toast(message: string, isError = false): void {
  toastEl.textContent = message
  toastEl.classList.toggle('error', isError)
  toastEl.hidden = false
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toastEl.hidden = true), 2600)
}

function photoName(index: number): string {
  const base = (conversation || 'Photo').replace(/[<>:"/\\|?*]+/g, '').trim() || 'Photo'
  return `${base} ${String(index + 1).padStart(3, '0')}`
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not read the image'))
    img.src = src
  })
}

async function render(photo: GalleryPhoto, mime: string, quality?: number): Promise<string> {
  const deg = rotation.get(photo.id) ?? 0
  const img = await loadImage(photo.dataUrl)
  const swap = deg % 180 !== 0
  const canvas = document.createElement('canvas')
  canvas.width = swap ? img.naturalHeight : img.naturalWidth
  canvas.height = swap ? img.naturalWidth : img.naturalHeight
  const ctx = canvas.getContext('2d')!
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate((deg * Math.PI) / 180)
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2)
  return canvas.toDataURL(mime, quality)
}

async function exportData(photo: GalleryPhoto): Promise<string> {
  if (!(rotation.get(photo.id) ?? 0)) return photo.dataUrl
  const lossy = photo.mime === 'image/jpeg' || photo.mime === 'image/webp'
  return lossy ? render(photo, 'image/jpeg', 0.95) : render(photo, 'image/png')
}

async function saveAs(index: number): Promise<void> {
  const photo = photos[index]
  if (!photo) return
  const path = await window.rex.saveAs(await exportData(photo), photoName(index))
  if (!path) return
  savedPaths.set(photo.id, path)
  if (index === current) vFolder.disabled = false
  toast(`Saved to ${path}`)
}

async function copy(index: number): Promise<void> {
  const photo = photos[index]
  if (!photo) return
  const ok = await window.rex.copy(await render(photo, 'image/png'))
  toast(ok ? 'Copied to clipboard' : 'Could not copy this photo', !ok)
}

async function openInApp(index: number): Promise<void> {
  const photo = photos[index]
  if (!photo) return
  const ok = await window.rex.openExternal(await exportData(photo), photoName(index))
  if (!ok) toast('No app is set up to open this photo', true)
}

async function showInFolder(index: number): Promise<void> {
  const photo = photos[index]
  const path = photo && savedPaths.get(photo.id)
  if (path) await window.rex.showInFolder(path)
}

async function saveAll(): Promise<void> {
  if (!photos.length) return
  buttons.saveAll.disabled = true
  try {
    const items = await Promise.all(photos.map(async (p, i) => ({ dataUrl: await exportData(p), name: photoName(i) })))
    const result = await window.rex.saveAll(items)
    if (!result) return
    toast(`Saved ${result.count} photo${result.count === 1 ? '' : 's'} to ${result.folder}`)
    if (result.first) void window.rex.showInFolder(result.first)
  } finally {
    buttons.saveAll.disabled = !photos.length
  }
}

// ---- Grid ------------------------------------------------------------------

function tileButton(label: string, title: string, action: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.textContent = label
  b.title = title
  b.onclick = (e) => {
    e.stopPropagation()
    action()
  }
  return b
}

function renderGrid(): void {
  grid.replaceChildren()
  photos.forEach((photo, index) => {
    const tile = document.createElement('div')
    tile.className = 'tile'
    tile.tabIndex = 0
    const img = document.createElement('img')
    img.src = photo.dataUrl
    img.alt = photoName(index)
    img.loading = 'lazy'
    img.draggable = false
    const deg = rotation.get(photo.id) ?? 0
    if (deg) img.style.transform = `rotate(${deg}deg)`
    const overlay = document.createElement('div')
    overlay.className = 'tile-actions'
    overlay.append(
      tileButton('Save', 'Save as', () => void saveAs(index)),
      tileButton('Copy', 'Copy image', () => void copy(index)),
      tileButton('Open', 'Open in your default photo app', () => void openInApp(index))
    )
    tile.append(img, overlay)
    tile.onclick = () => openViewer(index)
    tile.onkeydown = (e) => {
      if (e.key === 'Enter') openViewer(index)
    }
    grid.append(tile)
  })
}

function setState(message: string): void {
  stateEl.textContent = message
  stateEl.hidden = !message
}

async function load(older = false): Promise<void> {
  if (loading) return
  loading = true
  Object.values(buttons).forEach((b) => (b.disabled = true))
  setState(older ? 'Loading older photos...' : 'Loading photos from the open conversation...')
  try {
    const result = await window.rex.load(older)
    if (result.error) {
      photos = []
      conversation = ''
      setState(result.error)
    } else {
      conversation = result.conversation
      photos = result.photos
      setState(photos.length ? '' : 'No photos are loaded in this conversation. Try "Load older".')
    }
    rotation.clear()
    savedPaths.clear()
    titleEl.textContent = conversation ? `Photos - ${conversation}` : 'Photos'
    document.title = conversation ? `RexMessages - Photos - ${conversation}` : 'RexMessages - Photos'
    countEl.textContent = photos.length ? `${photos.length} photo${photos.length === 1 ? '' : 's'}` : ''
    renderGrid()
    if (!viewer.hidden) closeViewer()
  } finally {
    loading = false
    buttons.refresh.disabled = false
    buttons.older.disabled = false
    buttons.saveAll.disabled = !photos.length
  }
}

// ---- Viewer ----------------------------------------------------------------

function fitScale(): number {
  const photo = photos[current]
  if (!photo || !vImg.naturalWidth) return 1
  const deg = rotation.get(photo.id) ?? 0
  const w = deg % 180 ? vImg.naturalHeight : vImg.naturalWidth
  const h = deg % 180 ? vImg.naturalWidth : vImg.naturalHeight
  const pad = 32
  return Math.min((stage.clientWidth - pad) / w, (stage.clientHeight - pad) / h, 1)
}

function applyTransform(): void {
  const photo = photos[current]
  const deg = photo ? (rotation.get(photo.id) ?? 0) : 0
  vImg.style.transform = `translate(calc(-50% + ${panX}px), calc(-50% + ${panY}px)) rotate(${deg}deg) scale(${zoom})`
  vZoom.textContent = `${Math.round(zoom * 100)}%`
  stage.classList.toggle('pannable', zoom > fitScale() + 0.001)
}

function fit(): void {
  zoom = fitScale()
  panX = 0
  panY = 0
  applyTransform()
}

function setZoom(next: number): void {
  zoom = Math.min(8, Math.max(0.05, next))
  if (zoom <= fitScale()) {
    panX = 0
    panY = 0
  }
  applyTransform()
}

function show(index: number): void {
  if (!photos.length) return
  current = (index + photos.length) % photos.length
  const photo = photos[current]
  vIndex.textContent = `${current + 1} of ${photos.length}`
  vFolder.disabled = !savedPaths.has(photo.id)
  vImg.onload = fit
  vImg.src = photo.dataUrl
  if (vImg.complete) fit()
}

function openViewer(index: number): void {
  viewer.hidden = false
  show(index)
}

function closeViewer(): void {
  viewer.hidden = true
  const tile = grid.children[current] as HTMLElement | undefined
  tile?.focus()
}

function rotate(delta: number): void {
  const photo = photos[current]
  if (!photo) return
  rotation.set(photo.id, (((rotation.get(photo.id) ?? 0) + delta) % 360 + 360) % 360)
  fit()
  renderGrid()
}

const actions: Record<string, () => void> = {
  zoomIn: () => setZoom(zoom * 1.25),
  zoomOut: () => setZoom(zoom / 1.25),
  fit,
  rotateLeft: () => rotate(-90),
  rotateRight: () => rotate(90),
  save: () => void saveAs(current),
  copy: () => void copy(current),
  open: () => void openInApp(current),
  folder: () => void showInFolder(current),
  prev: () => show(current - 1),
  next: () => show(current + 1),
  close: closeViewer
}

viewer.addEventListener('click', (e) => {
  const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act
  if (act && actions[act]) actions[act]()
})

stage.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault()
    setZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15))
  },
  { passive: false }
)

let drag: { x: number; y: number; px: number; py: number } | null = null
stage.addEventListener('pointerdown', (e) => {
  if ((e.target as HTMLElement).closest('button') || zoom <= fitScale() + 0.001) return
  drag = { x: e.clientX, y: e.clientY, px: panX, py: panY }
  stage.setPointerCapture(e.pointerId)
})
stage.addEventListener('pointermove', (e) => {
  if (!drag) return
  panX = drag.px + (e.clientX - drag.x)
  panY = drag.py + (e.clientY - drag.y)
  applyTransform()
})
stage.addEventListener('pointerup', () => (drag = null))
stage.addEventListener('dblclick', (e) => {
  if ((e.target as HTMLElement).closest('button')) return
  if (zoom > fitScale() + 0.001) fit()
  else setZoom(1)
})

window.addEventListener('resize', () => {
  if (!viewer.hidden) fit()
})

document.addEventListener('keydown', (e) => {
  if (viewer.hidden) {
    if (e.key === 'F5' || (e.ctrlKey && e.key.toLowerCase() === 'r')) {
      e.preventDefault()
      void load(false)
    }
    return
  }
  const key = e.key.toLowerCase()
  if (e.ctrlKey && key === 's') {
    e.preventDefault()
    void saveAs(current)
  } else if (e.ctrlKey && key === 'c') {
    e.preventDefault()
    void copy(current)
  } else if (e.ctrlKey) {
    return
  } else if (key === 'escape') closeViewer()
  else if (key === 'arrowleft') show(current - 1)
  else if (key === 'arrowright') show(current + 1)
  else if (key === '+' || key === '=') setZoom(zoom * 1.25)
  else if (key === '-') setZoom(zoom / 1.25)
  else if (key === '0') fit()
  else if (key === 'r') rotate(e.shiftKey ? -90 : 90)
  else if (key === 'enter') void openInApp(current)
})

buttons.refresh.onclick = () => void load(false)
buttons.older.onclick = () => void load(true)
buttons.saveAll.onclick = () => void saveAll()
window.rex.onRefresh(() => void load(false))

void load(false)
