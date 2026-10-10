// Publishes a new version to GitHub Releases so installed copies auto-update.
//
//   npm run release              bump patch (0.1.0 -> 0.1.1), build, publish
//   npm run release -- minor     bump minor (0.1.0 -> 0.2.0)
//   npm run release -- major     bump major (0.1.0 -> 1.0.0)
//   npm run release -- current   publish the version already in package.json
//   npm run release -- notes     only rewrite the notes of the current version's release
//
// Needs: a clean git tree and either GH_TOKEN set or `gh auth login` done.
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const bump = process.argv[2] || 'patch'
if (!['patch', 'minor', 'major', 'current', 'notes'].includes(bump)) {
  console.error(`Unknown option "${bump}". Use patch, minor, major, current, or notes.`)
  process.exit(1)
}

const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts })
const read = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim()
const releaseExists = (tag) => {
  try {
    execSync(`gh release view ${tag}`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function releaseNotes(version) {
  const changelog = readFileSync('CHANGELOG.md', 'utf8')
  const section = changelog.split(/^## /m).find((s) => s.startsWith(`${version} `) || s.startsWith(`${version}\n`))
  const whatsNew = section ? section.split('\n').slice(1).join('\n').trim() : ''
  return `## Download

**Only download \`RexMessages-Setup-${version}.exe\`.** Run it to install RexMessages; that's all you need. If you already have RexMessages, it updates itself.

The other files are used by the app's automatic updater (\`latest.yml\`, \`.blockmap\`) or added by GitHub (Source code). You don't need to download them.

Windows may show a SmartScreen warning because the installer isn't signed. Click **More info**, then **Run anyway**.
${whatsNew ? `\n## What's new\n\n${whatsNew}\n` : ''}`
}

if (bump === 'notes') {
  const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
  execSync(`gh release edit v${version} --notes-file -`, { input: releaseNotes(version), stdio: ['pipe', 'inherit', 'inherit'] })
  process.exit(0)
}

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
const tag = `v${version}`
if (bump === 'current' && !read(`git tag --list ${tag}`)) run(`git tag ${tag}`)

// The tag must reach GitHub before the release exists, otherwise GitHub tags
// the old commit and this push is rejected later.
run('git push origin HEAD')
run(`git push origin ${tag}`)

const fail = () => {
  console.error(`\nBuild or upload failed, so ${tag} isn't complete yet. Fix the problem, then run:`)
  console.error('  npm run release -- current')
  process.exit(1)
}

try {
  run('npm run build')
} catch {
  fail()
}

// electron-builder uploads files in parallel and each upload creates the
// release if it's missing, which leaves duplicate releases. Create it first.
const notes = { input: releaseNotes(version), stdio: ['pipe', 'inherit', 'inherit'] }
if (releaseExists(tag)) execSync(`gh release edit ${tag} --notes-file -`, notes)
else execSync(`gh release create ${tag} --title ${version} --verify-tag --notes-file -`, notes)

try {
  run('npx electron-builder --win nsis --publish always', { env: { ...process.env, GH_TOKEN: token } })
} catch {
  fail()
}

console.log(`\nPublished ${tag}: https://github.com/reptar-rex-u/RexMessages/releases/tag/${tag}`)
