import { existsSync, readFileSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'

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

/** Resolves Windows command shims to local JavaScript launchers, without shell invocation or Corepack downloads. */
export function resolvePackageManagerCommand(
  cmd: string,
  args: string[],
  nodePath: string,
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
): Command {
  if (platform !== 'win32') return { cmd, args }
  const manager = cmd.toLowerCase().replace(/\.cmd$|\.exe$/, '')
  if (!['npm', 'yarn', 'pnpm'].includes(manager)) return { cmd, args }
  const roots = [...new Set([dirname(nodePath), ...(env.PATH ?? '').split(delimiter)].filter(Boolean))]
  const candidates = roots.flatMap((root) => {
    const packageRoot = join(root, 'node_modules', manager)
    return manager === 'npm'
      ? [join(packageRoot, 'bin', 'npm-cli.js')]
      : manager === 'yarn'
        ? [join(packageRoot, 'bin', 'yarn.js'), join(packageRoot, 'bin', 'yarn.cjs')]
        : [join(packageRoot, 'bin', 'pnpm.cjs'), join(packageRoot, 'bin', 'pnpm.js')]
  })
  const launcher = candidates.find(existsSync)
  if (!launcher)
    throw new Error(`${manager} launcher não encontrado para o Node selecionado; instale-o explicitamente nesse runtime`)
  return { cmd: nodePath, args: [launcher, ...args] }
}

export function detectPackageManager(dir: string): PackageManager {
  const declared = readDeclaredManager(dir)
  if (declared) return declared
  if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(dir, '.yarnrc.yml')) || existsSync(join(dir, '.yarnrc'))) return 'yarn'
  if (existsSync(join(dir, 'package-lock.json'))) return 'npm'
  if (existsSync(join(dir, 'yarn.lock'))) return 'yarn'
  return 'npm'
}

export function lockfileName(manager: PackageManager): string {
  return LOCKFILES[manager]
}

export function installCommand(dir: string): Command {
  const manager = detectPackageManager(dir)
  if (!existsSync(join(dir, lockfileName(manager)))) return { cmd: manager, args: ['install'] }
  if (manager === 'npm') return { cmd: manager, args: ['ci'] }
  if (manager === 'pnpm') return { cmd: manager, args: ['install', '--frozen-lockfile'] }
  const version = readDeclaredManagerVersion(dir)
  return { cmd: manager, args: version && Number(version.split('.')[0]) < 2 ? ['install', '--frozen-lockfile'] : ['install', '--immutable'] }
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
  if (detectPackageManager(dir) === 'yarn') return { cmd: 'yarn', args: [script, ...extra] }
  if (detectPackageManager(dir) === 'pnpm') return { cmd: 'pnpm', args: ['run', script, ...extra] }
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

function readDeclaredManagerVersion(dir: string): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { packageManager?: string }
    return typeof pkg.packageManager === 'string' ? /@(\d+\.\d+\.\d+)/.exec(pkg.packageManager)?.[1] : undefined
  } catch { return undefined }
}
