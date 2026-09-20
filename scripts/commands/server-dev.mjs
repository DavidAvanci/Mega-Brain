import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const tsxCli = resolve(repositoryRoot, 'node_modules/tsx/dist/cli.mjs')
if (!existsSync(tsxCli)) throw new Error('tsx não encontrado; execute npm install antes de iniciar o backend.')

// A development session is still a private API. Keep one generated capability
// for all hot-reload restarts, unless the developer explicitly supplied one.
const environment = {
  ...process.env,
  MEGA_BRAIN_SESSION_TOKEN: process.env.MEGA_BRAIN_SESSION_TOKEN ?? randomBytes(32).toString('base64url'),
  MEGA_BRAIN_SESSION_ID: process.env.MEGA_BRAIN_SESSION_ID ?? randomBytes(16).toString('base64url'),
}
const child = spawn(process.execPath, [tsxCli, 'watch', 'server/main.ts'], {
  cwd: repositoryRoot,
  env: environment,
  stdio: 'inherit',
})

let stopping = false
const stop = (signal) => {
  if (stopping) return
  stopping = true
  child.kill(signal)
}
process.once('SIGINT', () => stop('SIGINT'))
process.once('SIGTERM', () => stop('SIGTERM'))
child.once('error', (error) => {
  console.error(`Não foi possível iniciar tsx: ${error.message}`)
  process.exitCode = 1
})
child.once('exit', (code, signal) => {
  if (signal) process.exitCode = stopping ? 0 : 1
  else process.exitCode = code ?? 1
})
