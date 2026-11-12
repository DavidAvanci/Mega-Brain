import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import type { ProjectCommand } from '../../shared/domain/project-runtime.ts'
import { resolvePackageManagerCommand } from './packageManager.ts'

export interface ProjectCommandResult {
  status: 'passed' | 'failed' | 'timeout' | 'cancelled'
  code: number | null
  stdout: string
  stderr: string
  durationMs: number
  runtime?: { version: string; execPath: string }
}

export async function runProjectCommand(
  command: ProjectCommand,
  runtime: { execPath: string; version?: string },
  options: { signal?: AbortSignal; env?: NodeJS.ProcessEnv } = {},
): Promise<ProjectCommandResult> {
  if (!command.argv.length) throw new Error('argv do comando do projeto não pode ser vazio')
  const startedAt = Date.now()
  const base = options.env ?? process.env
  const env: NodeJS.ProcessEnv = { ...base, ...command.environment }
  const binDir = dirname(runtime.execPath)
  env.PATH = [binDir, join(command.cwd, 'node_modules', '.bin'), command.environment?.PATH ?? base.PATH]
    .filter(Boolean)
    .join(delimiter)
  env.MEGA_BRAIN_PROJECT_NODE = runtime.execPath
  const executable = resolvePackageManagerCommand(command.argv[0], command.argv.slice(1), runtime.execPath, env)
  const child = spawn(executable.cmd, executable.args, {
    cwd: command.cwd,
    env,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  })
  let stdout = '',
    stderr = '',
    status: ProjectCommandResult['status'] = 'failed'
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    stdout = (stdout + chunk).slice(-1_000_000)
  })
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-1_000_000)
  })
  return await new Promise((resolve, reject) => {
    let settled = false
    const stop = (reason: ProjectCommandResult['status']) => {
      if (settled) return
      status = reason
      if (process.platform !== 'win32' && child.pid) {
        try {
          process.kill(-child.pid, 'SIGTERM')
        } catch {}
      } else {
        if (child.pid) {
          const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
          killer.unref()
        } else child.kill('SIGTERM')
      }
      setTimeout(() => {
        if (child.exitCode === null && process.platform !== 'win32') child.kill('SIGKILL')
      }, 1000).unref()
    }
    const timeout = setTimeout(() => stop('timeout'), command.timeoutMs)
    const abort = () => stop('cancelled')
    options.signal?.addEventListener('abort', abort, { once: true })
    child.once('error', (error) => {
      if (!settled) {
        settled = true
        clearTimeout(timeout)
        reject(error)
      }
    })
    child.once('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', abort)
      if (status !== 'timeout' && status !== 'cancelled') status = code === 0 ? 'passed' : 'failed'
      const result: ProjectCommandResult = {
        status,
        code,
        stdout: redactCommandOutput(stdout),
        stderr: redactCommandOutput(stderr),
        durationMs: Date.now() - startedAt,
        ...(runtime.version ? { runtime: { version: runtime.version, execPath: runtime.execPath } } : {}),
      }
      if (command.recordFile) {
        try {
          appendFileSync(
            command.recordFile,
            `${JSON.stringify({ id: command.id, cwd: command.cwd, status: result.status, code: result.code, durationMs: result.durationMs, runtime: result.runtime })}\n`,
          )
        } catch (error) {
          reject(error)
          return
        }
      }
      resolve(result)
    })
  })
}

function redactCommandOutput(value: string): string {
  return value
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1[redacted]')
    .replace(
      /\b[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY)\s*=\s*[^\s]+/gi,
      '$1=[redacted]',
    )
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[redacted AWS key]')
}
