/**
 * Static release gate for the backend copied to WSL by the Windows executable.
 * It deliberately does not invoke wsl.exe: GitHub's Windows image is not a
 * substitute for a user-configured Windows + WSL2 acceptance environment.
 */
import { createHash } from 'node:crypto'
import { access, readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const bundlePath = resolve(root, 'dist/server/main.mjs')
const manifestPath = resolve(root, 'dist/server/runtime-manifest.json')
const supervisorPath = resolve(root, 'src-tauri/src/supervisor.rs')

async function requiredFile(path, description) {
  try {
    const details = await stat(path)
    if (!details.isFile() || details.size === 0) throw new Error('not a non-empty file')
    return details
  } catch (error) {
    throw new Error(`${description} is missing or empty (${path}): ${error.message}`)
  }
}

const bundle = await requiredFile(bundlePath, 'WSL backend bundle')
await requiredFile(manifestPath, 'WSL runtime manifest')

let manifest
try {
  manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
} catch (error) {
  throw new Error(`WSL runtime manifest is not valid JSON: ${error.message}`)
}

const actualHash = createHash('sha256').update(await readFile(bundlePath)).digest('hex')
if (manifest.schemaVersion !== 1 || manifest.entrypoint !== 'main.mjs') {
  throw new Error('WSL runtime manifest must use schemaVersion 1 and entrypoint main.mjs.')
}
if (!/^[0-9a-f]{64}$/.test(manifest.sha256 ?? '') || manifest.sha256 !== actualHash) {
  throw new Error('WSL runtime manifest SHA-256 does not match dist/server/main.mjs.')
}
if (!Number.isSafeInteger(manifest.sizeBytes) || manifest.sizeBytes !== bundle.size) {
  throw new Error('WSL runtime manifest sizeBytes does not match dist/server/main.mjs.')
}
if (typeof manifest.runtimeVersion !== 'string' || !/^[0-9A-Za-z][0-9A-Za-z._-]*$/.test(manifest.runtimeVersion)) {
  throw new Error('WSL runtime manifest runtimeVersion is invalid.')
}

// The native executable must compile these exact generated inputs into itself.
const supervisor = await readFile(supervisorPath, 'utf8')
for (const expected of [
  'include_bytes!("../../dist/server/main.mjs")',
  'include_str!("../../dist/server/runtime-manifest.json")',
  'sha256sum',
]) {
  if (!supervisor.includes(expected)) {
    throw new Error(`Windows runtime integration is incomplete: supervisor.rs lacks ${expected}.`)
  }
}

console.log(`WSL runtime valid: ${manifest.runtimeVersion}, ${bundle.size} bytes, ${actualHash}`)
