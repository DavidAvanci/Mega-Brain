import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export type PackageManager = 'npm' | 'yarn'

export interface Command {
  cmd: string
  args: string[]
}

export function detectPackageManager(dir: string): PackageManager {
  const declared = readDeclaredManager(dir)
  if (declared) return declared
  if (existsSync(join(dir, '.yarnrc.yml')) || existsSync(join(dir, '.yarnrc'))) return 'yarn'
  if (existsSync(join(dir, 'package-lock.json'))) return 'npm'
  if (existsSync(join(dir, 'yarn.lock'))) return 'yarn'
  return 'npm'
}

export function installCommand(dir: string): Command {
  return detectPackageManager(dir) === 'yarn'
    ? { cmd: 'yarn', args: ['install'] }
    : { cmd: 'npm', args: ['install'] }
}

export function lockfilesMatch(left: string, right: string): boolean {
  const manager = detectPackageManager(left)
  if (manager !== detectPackageManager(right)) return false
  const lockfile = manager === 'yarn' ? 'yarn.lock' : 'package-lock.json'
  try {
    return readFileSync(join(left, lockfile), 'utf8') === readFileSync(join(right, lockfile), 'utf8')
  } catch {
    return false
  }
}

export function runScriptCommand(dir: string, script: string, extra: string[] = []): Command {
  if (detectPackageManager(dir) === 'yarn') return { cmd: 'yarn', args: [script, ...extra] }
  return { cmd: 'npm', args: ['run', script, ...(extra.length ? ['--', ...extra] : [])] }
}

function readDeclaredManager(dir: string): PackageManager | null {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { packageManager?: string }
    if (typeof pkg.packageManager !== 'string') return null
    if (pkg.packageManager.startsWith('yarn')) return 'yarn'
    if (pkg.packageManager.startsWith('npm')) return 'npm'
    return null
  } catch {
    return null
  }
}
