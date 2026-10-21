import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import type { EnvironmentDiagnostic } from '../../shared/domain/project-runtime.ts'
import { detectPackageManager, lockfileName, lockfilesMatch } from './packageManager.ts'
import { resolveProjectNode } from './project-node.ts'

export interface ProjectEnvironmentResult {
  ready: boolean
  diagnostics: EnvironmentDiagnostic[]
  packageManager?: ReturnType<typeof detectPackageManager>
  nodeModules?: { path: string; linked: boolean }
}

export function diagnoseProjectEnvironment(dir: string, repo = dir, canonicalDir?: string): ProjectEnvironmentResult {
  const diagnostics: EnvironmentDiagnostic[] = []
  if (!existsSync(join(dir, 'package.json'))) return { ready: true, diagnostics }
  let pkg: {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
    engines?: { node?: string }
  }
  try {
    pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as typeof pkg
  } catch {
    return { ready: false, diagnostics: [{ repo, code: 'package-json-invalid', message: 'package.json inválido' }] }
  }
  const runtime = resolveProjectNode(dir, { allowServerDefault: true })
  if (runtime.status === 'blocked')
    diagnostics.push({
      repo,
      code: 'node-runtime-unavailable',
      message: runtime.diagnostic ?? 'Node do projeto indisponível',
    })
  const manager = detectPackageManager(dir)
  const lockfile = lockfileName(manager)
  if (!existsSync(join(dir, lockfile)))
    diagnostics.push({
      repo,
      code: 'lockfile-missing',
      message: `Dependências não verificáveis: falta ${lockfile} para ${manager}`,
    })
  if (canonicalDir && !lockfilesMatch(dir, canonicalDir))
    diagnostics.push({
      repo,
      code: 'shared-lockfile-mismatch',
      message:
        'Lockfile da worktree difere do checkout canônico; dependências compartilhadas precisam de install isolado',
    })
  const modules = join(dir, 'node_modules')
  const yarnPnp = manager === 'yarn' && (existsSync(join(dir, '.pnp.cjs')) || existsSync(join(dir, '.pnp.js')))
  let linked = false
  try {
    linked = lstatSync(modules).isSymbolicLink()
  } catch {}
  if (!existsSync(modules) && !yarnPnp) {
    diagnostics.push(linked
      ? { repo, code: 'dependencies-link-broken', message: 'Link node_modules quebrado' }
      : { repo, code: 'dependencies-missing', message: 'Dependências indisponíveis: node_modules ausente' })
  } else if (existsSync(modules)) {
    const target = (() => {
      try {
        return realpathSync(modules)
      } catch {
        return modules
      }
    })()
    if (linked && !existsSync(target))
      diagnostics.push({ repo, code: 'dependencies-link-broken', message: 'Link node_modules quebrado' })
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
      const packagePath = name.startsWith('@') ? join(modules, ...name.split('/')) : join(modules, name)
      if (!existsSync(packagePath))
        diagnostics.push({
          repo,
          code: 'dependency-missing',
          message: `Pacote declarado ausente: ${name}`,
          evidence: { package: name },
        })
    }
    return { ready: diagnostics.length === 0, diagnostics, packageManager: manager, nodeModules: { path: target, linked } }
  }
  return { ready: diagnostics.length === 0, diagnostics, packageManager: manager }
}
