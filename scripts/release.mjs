// Publishes a new version to GitHub Releases so installed copies auto-update.
//
//   npm run release              bump patch (0.1.0 -> 0.1.1), build, publish
//   npm run release -- minor     bump minor (0.1.0 -> 0.2.0)
//   npm run release -- major     bump major (0.1.0 -> 1.0.0)
//   npm run release -- current   publish the version already in package.json
//
// Needs: a clean git tree and either GH_TOKEN set or `gh auth login` done.
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const bump = process.argv[2] || 'patch'
if (!['patch', 'minor', 'major', 'current'].includes(bump)) {
  console.error(`Unknown option "${bump}". Use patch, minor, major, or current.`)
  process.exit(1)
}

const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts })
const read = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim()

if (read('git status --porcelain')) {
  console.error('Commit or stash your changes first; releases are built from a clean tree.')
  process.exit(1)
}

const token = process.env.GH_TOKEN || read('gh auth token')
if (!token) {
  console.error('No GitHub token. Run `gh auth login` or set GH_TOKEN.')
  process.exit(1)
}

if (bump !== 'current') run(`npm version ${bump} -m "Release v%s"`)
const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
if (bump === 'current' && !read(`git tag --list v${version}`)) run(`git tag v${version}`)

// The tag must reach GitHub before electron-builder creates the release,
// otherwise GitHub tags the old commit and this push is rejected later.
run('git push origin HEAD')
run(`git push origin v${version}`)

try {
  run('npm run build')
  run('npx electron-builder --win nsis --publish always', { env: { ...process.env, GH_TOKEN: token } })
} catch {
  console.error(`\nBuild or upload failed, so v${version} isn't live yet. Fix the problem, then run:`)
  console.error('  npm run release -- current')
  process.exit(1)
}

console.log(`\nPublished v${version}: https://github.com/reptar-rex-u/RexMessages/releases/tag/v${version}`)
