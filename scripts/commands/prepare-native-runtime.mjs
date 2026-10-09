import { execFileSync } from 'node:child_process'
import { chmod, copyFile, mkdir, readdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'darwin') process.exit(0)

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const runtimeDirectory = resolve(repositoryRoot, 'src-tauri/target/mega-brain-runtime')
const nodeTarget = resolve(runtimeDirectory, 'node')

await mkdir(runtimeDirectory, { recursive: true })
await copyFile(process.execPath, nodeTarget)
await chmod(nodeTarget, 0o755)
console.log(`Bundled native Node runtime (${process.arch}, ${process.version}).`)

const moduleCache = resolve(runtimeDirectory, 'swift-module-cache')
await mkdir(moduleCache, { recursive: true })
const nativeDirectory = resolve(repositoryRoot, 'src-tauri/native')
const swiftSources = (await readdir(nativeDirectory)).filter((file) => file.endsWith('.swift')).sort()
execFileSync(
  'xcrun',
  [
    'swiftc',
    '-parse-as-library',
    '-O',
    '-module-cache-path',
    moduleCache,
    '-target',
    `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macosx14.0`,
    ...swiftSources.map((file) => resolve(nativeDirectory, file)),
    '-o',
    resolve(runtimeDirectory, 'activity-island'),
  ],
  { stdio: 'inherit' },
)
await chmod(resolve(runtimeDirectory, 'activity-island'), 0o755)
console.log('Bundled native activity island (macOS 14+).')
