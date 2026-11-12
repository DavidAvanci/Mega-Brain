import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { Repository } from '../../shared/domain/repositories'
import { resolvePackageManagerCommand } from './packageManager.ts'

export interface CompanionArtifactIssue {
  status: 'missing' | 'inconclusive'
  target: string
  companionPath?: string
  artifact?: string
  reason: string
}

/** Reads only JSON configuration; executable JS configs are deliberately not evaluated. */
export function diagnoseCompanionArtifacts(
  projectDir: string,
  companions: { alias: string; path: string }[],
): CompanionArtifactIssue[] {
  const mapper = readStaticMapper(projectDir)
  if (mapper.status === 'inconclusive')
    return [{ status: 'inconclusive', target: mapper.target, reason: mapper.reason }]
  const issues: CompanionArtifactIssue[] = []
  for (const target of mapper.targets) {
    if (!isPathTarget(target)) continue
    const configured = target.replace(/^<rootDir>(?=$|[/\\])/, projectDir)
    const resolvedTarget = resolve(
      isAbsolute(configured) ? configured : projectDir,
      ...(isAbsolute(configured) ? [] : [configured]),
    )
    if (existsSync(resolvedTarget)) continue
    const companion = companions.find(({ path }) => inside(path, resolvedTarget))
    const artifact = companion ? relative(companion.path, resolvedTarget).split(sep).join('/') : undefined
    issues.push({
      status: 'missing',
      target,
      companionPath: companion?.path,
      artifact,
      reason: companion
        ? `Artefato companheiro ausente: ${target}`
        : `Alias estático aponta para arquivo ausente: ${target}`,
    })
  }
  return issues
}

function readStaticMapper(
  projectDir: string,
): { status: 'ok'; targets: string[] } | { status: 'inconclusive'; target: string; reason: string } {
  let pkg: Record<string, unknown>
  try {
    pkg = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8')) as Record<string, unknown>
  } catch {
    return { status: 'ok', targets: [] }
  }
  const jestConfig = existsSync(join(projectDir, 'jest.config.js')) || existsSync(join(projectDir, 'jest.config.ts'))
  const rawJest = pkg.jest
  if (jestConfig && !rawJest && !existsSync(join(projectDir, 'jest.config.json')))
    return {
      status: 'inconclusive',
      target: 'jest.config.*',
      reason: 'Configuração Jest executável não foi avaliada por segurança.',
    }
  let config = rawJest
  if (existsSync(join(projectDir, 'jest.config.json'))) {
    try {
      config = JSON.parse(readFileSync(join(projectDir, 'jest.config.json'), 'utf8'))
    } catch {
      return { status: 'inconclusive', target: 'jest.config.json', reason: 'Configuração JSON do Jest inválida.' }
    }
  }
  const mapper = config && typeof config === 'object' ? (config as Record<string, unknown>).moduleNameMapper : undefined
  const targets: string[] = []
  if (mapper !== undefined) {
    if (!mapper || typeof mapper !== 'object' || Array.isArray(mapper))
      return {
        status: 'inconclusive',
        target: 'moduleNameMapper',
        reason: 'moduleNameMapper não estático ou inválido.',
      }
    for (const [pattern, rawTarget] of Object.entries(mapper)) {
      if (/[*+?()[\]{}|\\]/.test(pattern)) {
        if (typeof rawTarget === 'string' && isPathTarget(rawTarget))
          return {
            status: 'inconclusive',
            target: pattern,
            reason: 'Alias regex só pode ser resolvido com contexto de importação.',
          }
        continue
      }
      const values = typeof rawTarget === 'string' ? [rawTarget] : Array.isArray(rawTarget) ? rawTarget : []
      if (!values.length || values.some((value) => typeof value !== 'string'))
        return { status: 'inconclusive', target: pattern, reason: 'Destino do alias não é literal.' }
      for (const value of values as string[]) {
        if (/\$\d|\*/.test(value))
          return { status: 'inconclusive', target: value, reason: 'Destino do alias contém substituição dinâmica.' }
        targets.push(value)
      }
    }
  }
  const tsConfigFile = join(projectDir, 'tsconfig.json')
  if (existsSync(tsConfigFile)) {
    try {
      const ts = JSON.parse(readFileSync(tsConfigFile, 'utf8')) as {
        compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> }
      }
      const base = resolve(projectDir, ts.compilerOptions?.baseUrl ?? '.')
      for (const [pattern, paths] of Object.entries(ts.compilerOptions?.paths ?? {})) {
        if (/[*?]/.test(pattern) || paths.some((path) => /[*?]/.test(path))) continue
        targets.push(...paths.map((path) => resolve(base, path)))
      }
    } catch {
      return {
        status: 'inconclusive',
        target: 'tsconfig.json',
        reason: 'tsconfig.json não pôde ser analisado como JSON estático.',
      }
    }
  }
  return { status: 'ok', targets }
}

function isPathTarget(target: string): boolean {
  return target.startsWith('<rootDir>') || target.startsWith('.') || isAbsolute(target)
}

function inside(root: string, path: string): boolean {
  const value = relative(resolve(root), resolve(path))
  return value === '' || (!value.startsWith(`..${sep}`) && value !== '..' && !isAbsolute(value))
}

export function runConfiguredCompanionBuild(
  consumer: Repository,
  companion: Repository,
  companionWorktree: string,
  artifact: string,
  options: { nodePath: string; env?: NodeJS.ProcessEnv },
): { status: 'built' | 'skipped' | 'failed'; note: string } {
  const configuration = consumer.companionBuilds?.find(
    (build) =>
      build.repositoryId === companion.id &&
      build.artifacts.some((path) => artifact === path || artifact.startsWith(`${path.replace(/\/$/, '')}/`)),
  )
  if (!configuration)
    return { status: 'skipped', note: `Nenhum build explícito cadastrado para ${companion.alias}:${artifact}` }
  const command = configuration.command[0]
  const args = configuration.command.slice(1)
  const env = {
    ...process.env,
    ...options.env,
    PATH: [dirname(options.nodePath), options.env?.PATH ?? process.env.PATH].filter(Boolean).join(delimiter),
  }
  try {
    const launcher = resolvePackageManagerCommand(command, args, options.nodePath, env)
    execFileSync(launcher.cmd, launcher.args, {
      cwd: companionWorktree,
      env,
      stdio: 'ignore',
      timeout: configuration.timeoutMs ?? 15 * 60_000,
      shell: false,
    })
    return { status: 'built', note: `Build autorizado executado em ${companion.alias}` }
  } catch (error) {
    const detail =
      error instanceof Error ? error.message.replace(/(token|secret|password)=\S+/gi, '$1=[redacted]') : String(error)
    return { status: 'failed', note: `Build de ${companion.alias} falhou: ${detail.slice(0, 500)}` }
  }
}
