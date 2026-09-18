import { build } from 'esbuild'
import { access, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { contentAddressedRuntimeVersion } from './lib/runtime-version.mjs'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputFile = resolve(repositoryRoot, 'dist/server/main.mjs')
const manifestFile = resolve(repositoryRoot, 'dist/server/runtime-manifest.json')

// The backend deliberately stays a JavaScript bundle: the Tauri runtime will
// execute it with the user's Node in WSL, so native Node APIs remain external
// while application code is self-contained and does not need tsx/Vite.
await rm(dirname(outputFile), { recursive: true, force: true })
await mkdir(dirname(outputFile), { recursive: true })
await build({
  absWorkingDir: repositoryRoot,
  entryPoints: ['server/main.ts'],
  outfile: outputFile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  // The supported WSL baseline is Node 18.19; do not require a newer Node.
  target: 'node18',
  sourcemap: true,
  sourcesContent: true,
  metafile: true,
  logLevel: 'info',
})

// Fail loudly rather than advertising a partial runtime to the supervisor.
await access(outputFile)
const artifact = await stat(outputFile)
if (!artifact.isFile() || artifact.size === 0) {
  throw new Error(`Bundle inválido: ${outputFile}`)
}
// This deliberately contains only artifact identity. Environment files and
// credentials remain in the WSL user's existing configuration.
const bundle = await readFile(outputFile)
const sha256 = createHash('sha256').update(bundle).digest('hex')
const baseRuntimeVersion = process.env.MEGA_BRAIN_RUNTIME_VERSION || process.env.npm_package_version || '0.1.0'
await writeFile(manifestFile, `${JSON.stringify({
  schemaVersion: 1,
  runtimeVersion: contentAddressedRuntimeVersion(baseRuntimeVersion, sha256),
  entrypoint: 'main.mjs',
  sha256,
  sizeBytes: artifact.size,
}, null, 2)}\n`)
console.log(`Backend bundle: dist/server/main.mjs (${artifact.size} bytes)`)
