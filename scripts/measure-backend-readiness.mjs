import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const entrypoint = resolve(repositoryRoot, 'dist/server/main.mjs')
const runs = parseRuns(process.env.MEGA_BRAIN_BENCHMARK_RUNS)
const timeoutMs = parseTimeout(process.env.MEGA_BRAIN_BENCHMARK_TIMEOUT_MS)

if (!existsSync(entrypoint)) {
  throw new Error('Bundle ausente. Execute npm run server:build antes da medição.')
}

const samples = []
for (let index = 0; index < runs; index++) samples.push(await measureOnce())

console.log(JSON.stringify({
  schemaVersion: 1,
  benchmark: 'standalone-backend-readiness',
  runs,
  unit: 'ms',
  ready: summary(samples.map((sample) => sample.readyMs)),
  usable: summary(samples.map((sample) => sample.usableMs)),
}, null, 2))

async function measureOnce() {
  const token = randomBytes(32).toString('base64url')
  const sessionId = randomBytes(16).toString('base64url')
  const startedAt = performance.now()
  const child = spawn(process.execPath, [entrypoint], {
    cwd: repositoryRoot,
    env: { ...process.env, MEGA_BRAIN_SESSION_TOKEN: token, MEGA_BRAIN_SESSION_ID: sessionId },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-4096) })
  try {
    const ready = await readReady(child, timeoutMs)
    const readyMs = performance.now() - startedAt
    const response = await fetch(`http://127.0.0.1:${ready.port}/health`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (response.status !== 200 || (await response.json()).status !== 'ready') {
      throw new Error('health não ficou pronta')
    }
    return { readyMs, usableMs: performance.now() - startedAt }
  } catch (error) {
    // Do not print inherited environment, child stdout, or stderr: they may
    // contain diagnostics retained by a real supervisor.  The error is only a
    // local classification for this opt-in benchmark.
    throw new Error(`Amostra de readiness falhou: ${error instanceof Error ? error.message : 'erro desconhecido'}${stderr ? ' (stderr capturado e omitido)' : ''}`)
  } finally {
    await stop(child)
  }
}

function readReady(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buffer = ''
    const timer = setTimeout(() => finish(new Error(`ready não recebida em ${timeoutMs} ms`)), timeoutMs)
    const onExit = () => finish(new Error('backend encerrou antes da ready'))
    const onData = (chunk) => {
      buffer += chunk
      const newline = buffer.indexOf('\n')
      if (newline < 0) return
      try {
        const value = JSON.parse(buffer.slice(0, newline))
        if (value?.type !== 'mega-brain-ready' || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535) throw new Error('ready inválida')
        finish(undefined, value)
      } catch { finish(new Error('ready inválida')) }
    }
    const finish = (error, value) => {
      clearTimeout(timer)
      child.stdout.off('data', onData)
      child.off('exit', onExit)
      error ? reject(error) : resolve(value)
    }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', onData)
    child.once('exit', onExit)
    child.once('error', () => finish(new Error('não foi possível iniciar o backend')))
  })
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  await new Promise((resolve) => child.once('exit', resolve))
}

function summary(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const at = (percentile) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentile) - 1)]
  return { min: round(sorted[0]), median: round(at(0.5)), p95: round(at(0.95)), max: round(sorted.at(-1)) }
}

function round(value) { return Number(value.toFixed(1)) }
function parseRuns(value) {
  const parsed = Number(value ?? 10)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) throw new Error('MEGA_BRAIN_BENCHMARK_RUNS deve ser inteiro entre 1 e 100.')
  return parsed
}
function parseTimeout(value) {
  const parsed = Number(value ?? 10_000)
  if (!Number.isInteger(parsed) || parsed < 100 || parsed > 60_000) throw new Error('MEGA_BRAIN_BENCHMARK_TIMEOUT_MS deve ser inteiro entre 100 e 60000.')
  return parsed
}
