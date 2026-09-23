import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import http from 'node:http'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const windows = process.platform === 'win32'
if (!windows) {
  throw new Error(
    'O shell do Mega Brain deve ser iniciado no Windows. Execute npm run tauri:dev pelo PowerShell no checkout Windows.',
  )
}
const viteCli = resolve(repositoryRoot, 'node_modules/vite/bin/vite.js')
const tauriCli = resolve(repositoryRoot, 'node_modules/@tauri-apps/cli/tauri.js')
const backendBuild = resolve(repositoryRoot, 'scripts/commands/server-build.mjs')
const viteOrigin = 'http://127.0.0.1:15173'
const vitePort = new URL(viteOrigin).port

for (const file of [viteCli, tauriCli, backendBuild]) {
  if (!existsSync(file)) throw new Error(`Dependência de desenvolvimento ausente: ${file}. Execute npm install.`)
}

function validProxy(value) {
  if (!value?.trim()) return false
  try {
    const url = new URL(value)
    return ['http:', 'https:', 'socks:', 'socks5:'].includes(url.protocol) && Boolean(url.hostname)
  } catch {
    return false
  }
}

function localDevelopmentEnvironment() {
  const environment = { ...process.env }
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
    if (key in environment && !validProxy(environment[key])) delete environment[key]
  }
  for (const key of ['NO_PROXY', 'no_proxy']) {
    const entries = (environment[key] ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
    for (const local of ['127.0.0.1', 'localhost']) {
      if (!entries.includes(local)) entries.push(local)
    }
    environment[key] = entries.join(',')
  }
  const cargoBin = resolve(environment.USERPROFILE, '.cargo', 'bin')
  environment.Path = [cargoBin, dirname(process.execPath), environment.Path ?? ''].join(';')
  return environment
}

function waitForExit(child) {
  return new Promise((resolveExit, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolveExit({ code, signal }))
  })
}

async function run(command, args, environment) {
  const child = spawn(command, args, { cwd: repositoryRoot, env: environment, stdio: 'inherit' })
  const result = await waitForExit(child)
  if (result.code !== 0) throw new Error(`${command} encerrou com código ${result.code ?? result.signal}`)
}

function probeVite() {
  return new Promise((resolveProbe) => {
    const request = http.get(`${viteOrigin}/@vite/client`, { timeout: 750 }, (response) => {
      const contentType = response.headers['content-type'] ?? ''
      const viteResponse = response.statusCode === 200 && /javascript|typescript/.test(contentType)
      response.resume()
      response.on('end', () => resolveProbe(viteResponse ? 'vite' : 'other'))
    })
    request.on('timeout', () => request.destroy())
    request.on('error', () => resolveProbe('closed'))
  })
}

async function waitForVite(child) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Vite encerrou antes de ficar pronto (código ${child.exitCode}).`)
    if ((await probeVite()) === 'vite') return
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error(`Vite não respondeu em ${viteOrigin} dentro de 15 segundos.`)
}

const environment = localDevelopmentEnvironment()
let ownedVite
let tauri
let stopping = false

function stop(signal) {
  if (stopping) return
  stopping = true
  if (tauri?.exitCode === null) tauri.kill(signal)
  if (ownedVite?.exitCode === null) ownedVite.kill(signal)
}

process.once('SIGINT', () => stop('SIGINT'))
process.once('SIGTERM', () => stop('SIGTERM'))

try {
  await run(process.execPath, [backendBuild], environment)
  const existingServer = await probeVite()
  if (existingServer === 'other') {
    throw new Error(`A porta ${vitePort} já está ocupada por um servidor que não é o Vite deste projeto.`)
  }
  if (existingServer === 'closed') {
    ownedVite = spawn(process.execPath, [viteCli, '--host', '127.0.0.1', '--port', vitePort], {
      cwd: repositoryRoot,
      env: environment,
      stdio: 'inherit',
    })
    await waitForVite(ownedVite)
  } else {
    console.log(`Reutilizando Vite já ativo em ${viteOrigin}`)
  }

  tauri = spawn(process.execPath, [tauriCli, 'dev'], { cwd: repositoryRoot, env: environment, stdio: 'inherit' })
  const result = await waitForExit(tauri)
  if (!stopping && result.code !== 0) process.exitCode = result.code ?? 1
} finally {
  if (ownedVite?.exitCode === null) ownedVite.kill('SIGTERM')
}
