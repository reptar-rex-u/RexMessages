import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const require = createRequire(import.meta.url)

function loadEsbuild() {
  try {
    return require('esbuild')
  } catch {
    const vitePkg = dirname(require.resolve('vite/package.json'))
    return require(require.resolve('esbuild', { paths: [vitePkg] }))
  }
}

const esbuild = loadEsbuild()
mkdirSync('out/test', { recursive: true })
await esbuild.build({
  entryPoints: ['src/main/notes.test.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: 'out/test/notes.test.cjs',
  sourcemap: 'inline',
  external: ['electron']
})

const result = spawnSync(process.execPath, ['--enable-source-maps', '--test', 'out/test/notes.test.cjs'], {
  stdio: 'inherit'
})
process.exit(result.status ?? 1)
