import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const tauriCli = resolve(repositoryRoot, 'node_modules/@tauri-apps/cli/tauri.js')
const environment = { ...process.env }

// Tauri skips the cosmetic Finder AppleScript when CI=true. Creating the app,
// Applications link and compressed DMG still runs, without GUI automation.
if (process.platform === 'darwin') environment.CI = 'true'

const child = spawn(process.execPath, [tauriCli, 'build', ...process.argv.slice(2)], {
  cwd: repositoryRoot,
  env: environment,
  stdio: 'inherit',
})

child.once('error', (error) => {
  console.error(`Não foi possível iniciar o build Tauri: ${error.message}`)
  process.exitCode = 1
})
child.once('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exitCode = code ?? 1
})
