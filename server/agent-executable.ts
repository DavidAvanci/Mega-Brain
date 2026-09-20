import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Resolves agents installed in a user path that WSL-launched processes may not inherit. */
export function claudeBin(configured?: string): string {
  if (configured) return configured
  const userInstall = join(homedir(), '.local', 'bin', 'claude')
  if (existsSync(userInstall)) return userInstall
  for (const dir of (process.env.PATH ?? '').split(':')) {
    const bin = join(dir, 'claude')
    if (dir && existsSync(bin)) return bin
  }
  return 'claude'
}

export function codexBin(configured?: string): string {
  if (configured) return configured
  for (const dir of (process.env.PATH ?? '').split(':')) {
    const bin = join(dir, 'codex')
    if (dir && existsSync(bin)) return bin
  }
  return 'codex'
}
