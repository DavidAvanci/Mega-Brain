import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { delimiter, join, resolve } from 'node:path'
import * as semver from 'semver'
import type {
  NodeRuntimeRequirement,
  ResolvedProjectRuntime,
  RuntimePolicy,
} from '../../shared/domain/project-runtime.ts'

export interface ResolveProjectNodeOptions {
  override?: string
  policy?: RuntimePolicy
  allowServerDefault?: boolean
  env?: NodeJS.ProcessEnv
}

export interface ProjectNodeResolution {
  status: 'resolved' | 'blocked'
  runtime?: ResolvedProjectRuntime
  diagnostic?: string
}

export function nodeRequirement(dir: string, options: ResolveProjectNodeOptions = {}): NodeRuntimeRequirement {
  const policy = options.policy ?? 'strict'
  if (options.override?.trim()) return { source: 'override', value: options.override.trim(), policy }
  for (const [filename, source] of [
    ['.nvmrc', '.nvmrc'],
    ['.node-version', '.node-version'],
  ] as const) {
    try {
      const value = readFileSync(join(dir, filename), 'utf8').trim()
      if (value) return { source, value: value.replace(/^v(?=\d)/, ''), policy }
    } catch {}
  }
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { engines?: { node?: unknown } }
    if (typeof pkg.engines?.node === 'string' && pkg.engines.node.trim())
      return { source: 'engines.node', value: pkg.engines.node.trim(), policy }
  } catch {}
  return { source: 'none', policy: options.allowServerDefault ? 'server-default' : policy }
}

export function resolveProjectNode(dir: string, options: ResolveProjectNodeOptions = {}): ProjectNodeResolution {
  const env = options.env ?? process.env
  const requirement = nodeRequirement(dir, options)
  const bins = installedNodeBinaries(env)
  const candidates = bins
    .map((execPath) => probe(execPath))
    .filter((value): value is { execPath: string; version: string } => Boolean(value))
  if (!requirement.value) {
    if (!options.allowServerDefault)
      return {
        status: 'blocked',
        diagnostic: `${dir}: requisito Node ausente; configure override, .nvmrc, .node-version ou engines.node`,
      }
    let current: { execPath: string; version: string } | undefined
    try {
      const command = process.platform === 'win32' ? 'node.exe' : 'node'
      const pathNode = execFileSync(command, ['-p', 'process.execPath'], {
        encoding: 'utf8',
        timeout: 3000,
        env,
      }).trim()
      current = probe(pathNode)
    } catch {}
    current ??=
      candidates.find((item) => resolve(item.execPath) === resolve(process.execPath)) ?? probe(process.execPath)
    if (!current) return { status: 'blocked', diagnostic: 'Não foi possível sondar o Node do servidor' }
    return {
      status: 'resolved',
      runtime: { server: { version: process.version, execPath: process.execPath }, project: current, requirement },
    }
  }
  const requested = normalizeRequirement(requirement.value, env)
  if (!requested)
    return { status: 'blocked', diagnostic: `Requisito Node inválido ou alias LTS indisponível: ${requirement.value}` }
  const engines = readEngine(dir)
  const compatible = candidates.filter(
    (item) => semver.satisfies(item.version, requested) && (!engines || semver.satisfies(item.version, engines)),
  )
  compatible.sort((a, b) => semver.compare(b.version, a.version) || a.execPath.localeCompare(b.execPath))
  let chosen = compatible[0]
  let warning: string | undefined
  if (!chosen && requirement.policy === 'same-major-fallback' && semver.valid(requested)) {
    const major = Number(requested.split('.')[0])
    const fallback = candidates
      .filter(
        (item) => Number(item.version.split('.')[0]) === major && (!engines || semver.satisfies(item.version, engines)),
      )
      .sort((a, b) => semver.compare(b.version, a.version) || a.execPath.localeCompare(b.execPath))[0]
    if (fallback) {
      chosen = fallback
      warning = `Fallback explícito: requisito ${requirement.value}, usando ${fallback.version}`
    }
  }
  if (!chosen)
    return {
      status: 'blocked',
      diagnostic: `${dir}: nenhum Node instalado satisfaz ${requirement.value}${engines ? ` e engines.node ${engines}` : ''}`,
    }
  return {
    status: 'resolved',
    runtime: {
      server: { version: process.version, execPath: process.execPath },
      project: chosen,
      requirement,
      ...(warning ? { warning } : {}),
    },
  }
}

function readEngine(dir: string): string | undefined {
  try {
    const value = (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { engines?: { node?: unknown } })
      .engines?.node
    return typeof value === 'string' && semver.validRange(value) ? value : undefined
  } catch {
    return undefined
  }
}

function normalizeRequirement(value: string, env: NodeJS.ProcessEnv): string | null {
  if (/^(lts(?:\/\*)?|node)$/i.test(value)) {
    const root = join(env.NVM_DIR || join(env.HOME || '', '.nvm'), 'alias')
    const aliasFiles = value.toLowerCase() === 'node' ? [join(root, 'node')] : [join(root, 'lts')]
    if (value.toLowerCase() !== 'node') {
      try {
        aliasFiles.push(...readdirSync(join(root, 'lts')).map((name) => join(root, 'lts', name)))
      } catch {}
    }
    const resolved = aliasFiles.flatMap((aliasFile) => {
      try {
        const alias = readFileSync(aliasFile, 'utf8').trim().replace(/^v/, '')
        const version = semver.valid(alias)
        return version ? [version] : []
      } catch { return [] }
    })
    return resolved.sort((a, b) => semver.compare(b, a))[0] ?? null
  }
  const exact = value.match(/^v?(\d+\.\d+\.\d+)$/)
  if (exact) return exact[1]
  return semver.validRange(value) ? value : null
}

function installedNodeBinaries(env: NodeJS.ProcessEnv): string[] {
  const paths = new Set<string>()
  const nvmRoot = env.NVM_DIR || join(env.HOME || '', '.nvm')
  for (const root of [join(nvmRoot, 'versions', 'node'), '/usr/local/nvm/versions/node']) {
    try {
      for (const version of readdirSync(root)) paths.add(join(root, version, 'bin', 'node'))
    } catch {}
  }
  for (const directory of (env.PATH ?? '').split(delimiter))
    if (directory) paths.add(join(directory, process.platform === 'win32' ? 'node.exe' : 'node'))
  paths.add(process.execPath)
  return [...paths].filter((path) => existsSync(path))
}

function probe(execPath: string): { execPath: string; version: string } | undefined {
  try {
    const version = execFileSync(execPath, ['-p', 'process.version'], { encoding: 'utf8', timeout: 3000 })
      .trim()
      .replace(/^v/, '')
    const reportedPath = execFileSync(execPath, ['-p', 'process.execPath'], { encoding: 'utf8', timeout: 3000 }).trim()
    return semver.valid(version) ? { execPath: reportedPath || execPath, version } : undefined
  } catch {
    return undefined
  }
}
