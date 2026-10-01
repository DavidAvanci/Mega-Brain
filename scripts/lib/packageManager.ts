import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export type PackageManager = 'npm' | 'yarn' | 'pnpm'

const LOCKFILES: Record<PackageManager, string> = {
  npm: 'package-lock.json',
  yarn: 'yarn.lock',
  pnpm: 'pnpm-lock.yaml',
}

export interface Command {
  cmd: string
  args: string[]
}

export function detectPackageManager(dir: string): PackageManager {
  const declared = readDeclaredManager(dir)
  if (declared) return declared
  if (existsSync(join(dir, '.yarnrc.yml')) || existsSync(join(dir, '.yarnrc'))) return 'yarn'
  if (existsSync(join(dir, 'package-lock.json'))) return 'npm'
  if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(dir, 'yarn.lock'))) return 'yarn'
  return 'npm'
}

export function lockfileName(manager: PackageManager): string {
  return LOCKFILES[manager]
}

export function installCommand(dir: string): Command {
  return { cmd: detectPackageManager(dir), args: ['install'] }
}

export function lockfilesMatch(left: string, right: string): boolean {
  const manager = detectPackageManager(left)
  if (manager !== detectPackageManager(right)) return false
  const lockfile = lockfileName(manager)
  try {
    return readFileSync(join(left, lockfile), 'utf8') === readFileSync(join(right, lockfile), 'utf8')
  } catch {
    return false
  }
}

export function runScriptCommand(dir: string, script: string, extra: string[] = []): Command {
  const manager = detectPackageManager(dir)
  if (manager !== 'npm') return { cmd: manager, args: [script, ...extra] }
  return { cmd: 'npm', args: ['run', script, ...(extra.length ? ['--', ...extra] : [])] }
}

function readDeclaredManager(dir: string): PackageManager | null {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { packageManager?: string }
    if (typeof pkg.packageManager !== 'string') return null
    if (pkg.packageManager.startsWith('yarn')) return 'yarn'
    if (pkg.packageManager.startsWith('pnpm')) return 'pnpm'
    if (pkg.packageManager.startsWith('npm')) return 'npm'
    return null
  } catch {
    return null
  }
}
