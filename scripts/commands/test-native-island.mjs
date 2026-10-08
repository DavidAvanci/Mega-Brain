import { execFileSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'darwin') {
  console.log('Native island checks require macOS; skipped on this platform.')
  process.exit(0)
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const output = resolve(root, 'src-tauri/target/mega-brain-runtime')
const cache = resolve(output, 'swift-module-cache')
await mkdir(cache, { recursive: true })
const binary = resolve(output, 'activity-island-checks')
execFileSync('xcrun', [
  'swiftc', '-parse-as-library', '-module-cache-path', cache,
  '-target', `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macosx14.0`,
  resolve(root, 'src-tauri/native/IslandModels.swift'),
  resolve(root, 'src-tauri/native/IslandModel.swift'),
  resolve(root, 'scripts/tests/activity-island-native.swift'),
  '-o', binary,
], { stdio: 'inherit' })
execFileSync(binary, [], { stdio: 'inherit' })
