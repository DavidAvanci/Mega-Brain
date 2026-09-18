import { basename, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'

/**
 * Test-only safety boundary.  It deliberately lives outside server/ so no
 * production entrypoint imports it.  Vitest loads it before test modules.
 */
const temporaryRoot = resolve(tmpdir())
const WORKSPACE_GUARD = Symbol.for('mega-brain.test-safety.workspace')

export function isSafeTestPath(path: string | undefined): boolean {
  if (!path) return false
  const resolved = resolve(path)
  return resolved === temporaryRoot || resolved.startsWith(`${temporaryRoot}${sep}`)
}

export function assertSafeTestWorkspace(path: string): void {
  if (!isSafeTestPath(path)) {
    throw new Error(`TEST SAFETY: workspace must be inside ${temporaryRoot}; refused ${resolve(path)}`)
  }
}

;(globalThis as Record<symbol, unknown>)[WORKSPACE_GUARD] = assertSafeTestWorkspace

function commandName(command: string): string {
  return basename(command).replace(/\.exe$/i, '').toLowerCase()
}

function commandCwd(args: readonly unknown[], options: unknown): string | undefined {
  const explicit = options && typeof options === 'object' ? (options as { cwd?: unknown }).cwd : undefined
  if (typeof explicit === 'string') return explicit
  const at = args.findIndex((arg) => arg === '-C')
  return at >= 0 && typeof args[at + 1] === 'string' ? args[at + 1] : undefined
}

export function assertSafeTestProcess(command: string, args: readonly unknown[] = [], options?: unknown): void {
  const name = commandName(command)
  if (name === 'claude' || name.startsWith('claude-')) {
    throw new Error(`TEST SAFETY: refused to spawn Claude executable ${command}`)
  }
  if (['sh', 'bash', 'zsh', 'fish', 'cmd', 'powershell', 'pwsh', 'curl', 'wget'].includes(name)) {
    throw new Error(`TEST SAFETY: refused potentially unsafe executable ${command}`)
  }
  if (name === 'git' && !isSafeTestPath(commandCwd(args, options))) {
    throw new Error('TEST SAFETY: git may run only with a cwd (or -C) inside the temporary test directory')
  }
}

export function assertSafeTestFetch(input: RequestInfo | URL): void {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  if (/(^|\.)atlassian\.net$/i.test(url.hostname)) {
    throw new Error(`TEST SAFETY: refused real Jira fetch to ${url.origin}`)
  }
}

const realSpawn = childProcess.spawn
const realExecFileSync = childProcess.execFileSync
const realExecFile = childProcess.execFile
childProcess.spawn = ((command: string, args: string[] = [], options?: unknown) => {
  assertSafeTestProcess(command, args, options)
  return realSpawn(command, args, options as Parameters<typeof realSpawn>[2])
}) as typeof childProcess.spawn
childProcess.execFileSync = ((command: string, args: string[] = [], options?: unknown) => {
  assertSafeTestProcess(command, args, options)
  return realExecFileSync(command, args, options as Parameters<typeof realExecFileSync>[2])
}) as typeof childProcess.execFileSync
childProcess.execFile = ((command: string, args: string[] = [], options: unknown, callback: Parameters<typeof realExecFile>[3]) => {
  assertSafeTestProcess(command, args, options)
  return realExecFile(command, args, options as Parameters<typeof realExecFile>[2], callback)
}) as typeof childProcess.execFile
syncBuiltinESMExports()

const originalFetch = globalThis.fetch.bind(globalThis)
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  assertSafeTestFetch(input)
  return originalFetch(input, init)
}) as typeof fetch
