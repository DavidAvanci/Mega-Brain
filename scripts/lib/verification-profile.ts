import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { VerificationProfile } from '../../shared/domain/verification.ts'
import { resolveProjectNode } from './project-node.ts'
import { detectVerificationAdapters, majorVersion } from './verification-adapters.ts'
import { runScriptCommand } from './packageManager.ts'

const CONFIGS = [
  'package.json',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  '.npmrc',
  '.yarnrc',
  '.yarnrc.yml',
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'jest.config.json',
  'tsconfig.json',
  'vitest.config.ts',
  'vite.config.ts',
  'biome.json',
  'biome.jsonc',
  'prettier.config.js',
  '.prettierrc',
  '.nvmrc',
  '.node-version',
]

export function discoverVerificationProfile(
  dir: string,
  repo: string,
  options: { override?: string; policy?: import('../../shared/domain/project-runtime.ts').RuntimePolicy } = {},
): VerificationProfile {
  dir = realpathSync(dir)
  const runtime = resolveProjectNode(dir, { ...options, allowServerDefault: true })
  if (runtime.status !== 'resolved' || !runtime.runtime?.project)
    throw new Error(runtime.diagnostic ?? 'Runtime indisponível')
  if (!existsSync(join(dir, 'package.json'))) {
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ repo, requirement: runtime.runtime.requirement, project: runtime.runtime.project }))
      .digest('hex')
    return {
      schemaVersion: 1,
      repo,
      fingerprint,
      runtime: runtime.runtime,
      commands: [],
      skipped: [{ id: 'project-checks', reason: 'Repositório sem package.json; não há checks Node aplicáveis.' }],
      formatting: { mode: 'disabled', reason: 'Repositório sem package.json.' },
      createdAt: new Date().toISOString(),
    }
  }
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>
    megaBrain?: { verification?: { formatWholeFiles?: unknown } }
  }
  const commands = [] as VerificationProfile['commands']
  const skipped: VerificationProfile['skipped'] = []
  for (const id of ['typecheck', 'test', 'build']) {
    const tscLauncher = join(dir, 'node_modules', 'typescript', 'bin', 'tsc')
    const inferredTypecheck = id === 'typecheck' && !pkg.scripts?.typecheck && /\btsc(?:\s|$)/.test(pkg.scripts?.build ?? '') && existsSync(tscLauncher)
    if (!pkg.scripts?.[id] && !inferredTypecheck) continue
    const command = inferredTypecheck
      ? { cmd: runtime.runtime.project.execPath, args: [tscLauncher, '--noEmit'] }
      : runScriptCommand(dir, id)
    commands.push({
      id,
      argv: [command.cmd, ...command.args],
      cwd: dir,
      timeoutMs: id === 'build' ? 30 * 60_000 : 20 * 60_000,
      writeMode: 'project',
      scope: 'project',
    })
  }
  const adapters = detectVerificationAdapters(dir)
  const lintScript = pkg.scripts?.lint ?? Object.values(pkg.scripts ?? {}).find((script) => /\beslint\b/.test(script)) ?? ''
  const eslintArgs = lintScript.match(/\beslint\b([^;&|]*)/)?.[1]?.trim().split(/\s+/).filter(Boolean) ?? []
  const optionIndex = eslintArgs.findIndex((target) => target.startsWith('-'))
  const eslintTargets = eslintArgs.slice(0, optionIndex < 0 ? eslintArgs.length : optionIndex)
  for (const adapter of adapters) {
    if (adapter.id === 'biome' && majorVersion(adapter.version) < 2) {
      skipped.push({ id: 'biome', reason: 'A versão local do Biome não oferece reporter estruturado suportado pelo adapter.' })
      continue
    }
    const argv =
      adapter.id === 'eslint'
        ? [adapter.executable, '--format', 'json']
        : adapter.id === 'prettier'
          ? [adapter.executable, '--check']
          : [adapter.executable, 'check', '--reporter=json']
    commands.push({
      id: adapter.id === 'prettier' ? 'format-check' : adapter.id,
      argv,
      cwd: dir,
      timeoutMs: 10 * 60_000,
      writeMode: 'read-only',
      scope: 'card-files',
      ...(adapter.id === 'eslint' && eslintTargets?.length ? { targets: eslintTargets } : {}),
    })
  }
  if (!adapters.length)
    skipped.push({ id: 'lint-format', reason: 'Não há adapter local suportado associado a script do projeto.' })
  const sourceFiles = CONFIGS.filter((file) => existsSync(join(dir, file))).sort()
  const hash = createHash('sha256')
  hash.update('whole-project-fallback-v1')
  for (const file of sourceFiles) {
    hash.update(file)
    hash.update(readFileSync(join(dir, file)))
  }
  hash.update(runtime.runtime.project.version).update(runtime.runtime.project.execPath)
  for (const adapter of adapters) hash.update(adapter.id).update(adapter.version ?? 'version-unavailable')
  const profile: VerificationProfile = {
    schemaVersion: 1,
    repo,
    fingerprint: hash.digest('hex'),
    runtime: runtime.runtime,
    commands,
    skipped,
    formatting:
      pkg.megaBrain?.verification?.formatWholeFiles === true
        ? { mode: 'whole-file' }
        : { mode: 'disabled', reason: 'O repositório não autorizou formatação de arquivo inteiro.' },
    createdAt: new Date().toISOString(),
  }
  return profile
}

export function verificationFilesForCommand(command: VerificationProfile['commands'][number], files: string[]): { files: string[]; excluded: string[] } {
  const eligible = (file: string) =>
    !/\.(?:png|jpe?g|gif|webp|ico|svg|bmp|tiff?)$/i.test(file) &&
    !/(?:^|\/)routeTree\.gen\.ts$/.test(file) &&
    (!command.targets?.length || command.targets.some((target) => file === target || file.startsWith(`${target.replace(/\/$/, '')}/`)))
  return { files: files.filter(eligible), excluded: files.filter((file) => !eligible(file)) }
}

export function persistVerificationProfile(path: string, profile: VerificationProfile): void {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify(profile, null, 2)}\n`, { flag: 'wx' })
    renameSync(temporary, path)
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary)
  }
}

export function loadValidVerificationProfile(
  path: string,
  dir: string,
  repo: string,
  options: { override?: string; policy?: import('../../shared/domain/project-runtime.ts').RuntimePolicy } = {},
): VerificationProfile {
  const current = discoverVerificationProfile(dir, repo, options)
  try {
    const saved = JSON.parse(readFileSync(path, 'utf8')) as VerificationProfile
    if (saved.schemaVersion === 1 && saved.repo === repo && saved.fingerprint === current.fingerprint) return saved
  } catch {}
  persistVerificationProfile(path, current)
  return current
}
