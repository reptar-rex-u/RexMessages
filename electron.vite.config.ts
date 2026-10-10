import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        // Sandboxed preloads cannot require sibling chunks, so these entries
        // must never import shared runtime modules from each other.
        input: {
          inject: resolve(__dirname, 'src/preload/inject.ts'),
          popup: resolve(__dirname, 'src/preload/popup.ts'),
          gallery: resolve(__dirname, 'src/preload/gallery.ts'),
          sw: resolve(__dirname, 'src/preload/sw.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: {
        input: {
          popup: resolve(__dirname, 'src/renderer/popup/index.html'),
          gallery: resolve(__dirname, 'src/renderer/gallery/index.html')
        }
      }
    }
  }
})
