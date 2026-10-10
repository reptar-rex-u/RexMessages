// Generates every app, tray, and taskbar badge icon from inline SVG.
// Run with: npm run build:icons
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'resources')
const badgeDir = join(out, 'badges')

const appSvg = (dot = false) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4f8cff"/>
      <stop offset="1" stop-color="#1a5fd6"/>
    </linearGradient>
  </defs>
  <rect x="8" y="8" width="240" height="240" rx="56" fill="url(#g)"/>
  <path d="M64 74 h128 a24 24 0 0 1 24 24 v58 a24 24 0 0 1 -24 24 h-70 l-36 30 v-30 h-22 a24 24 0 0 1 -24 -24 v-58 a24 24 0 0 1 24 -24 z" fill="#ffffff"/>
  <circle cx="96" cy="127" r="11" fill="#1a5fd6"/>
  <circle cx="128" cy="127" r="11" fill="#1a5fd6"/>
  <circle cx="160" cy="127" r="11" fill="#1a5fd6"/>
  ${dot ? '<circle cx="206" cy="50" r="46" fill="#ea4335" stroke="#ffffff" stroke-width="10"/>' : ''}
</svg>`

const badgeSvg = (label) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <circle cx="32" cy="32" r="30" fill="#ea4335"/>
  <text x="32" y="${label.length > 1 ? 42 : 45}" text-anchor="middle"
        font-family="Segoe UI, Arial, sans-serif" font-weight="700"
        font-size="${label.length > 1 ? 30 : 40}" fill="#ffffff">${label}</text>
</svg>`

const png = (svg, size) => sharp(Buffer.from(svg)).resize(size, size).png().toBuffer()

await mkdir(badgeDir, { recursive: true })

await writeFile(join(out, 'icon.png'), await png(appSvg(), 512))
const icoSizes = [16, 24, 32, 48, 64, 128, 256]
const icoPngs = await Promise.all(icoSizes.map((s) => png(appSvg(), s)))
await writeFile(join(out, 'icon.ico'), await pngToIco(icoPngs))

await writeFile(join(out, 'tray.png'), await png(appSvg(), 32))
await writeFile(join(out, 'tray-unread.png'), await png(appSvg(true), 32))

for (let n = 1; n <= 9; n++) {
  await writeFile(join(badgeDir, `${n}.png`), await png(badgeSvg(String(n)), 32))
}
await writeFile(join(badgeDir, '9plus.png'), await png(badgeSvg('9+'), 32))

console.log('Icons written to', out)
