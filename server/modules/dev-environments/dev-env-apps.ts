import { existsSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { runScriptCommand, type Command } from '../../../scripts/lib/packageManager'
import { activeRepositories, activeRepositoryPath } from '../../repositories/catalog'
import { parseEnvironmentVariables } from '../../repositories/environment-files'
import type { DevEnvApp } from '../../../shared/domain/agents'

export type RegisteredApp = {
  repo: string
  root: string
  dir: string
  canonical: string
  kind: DevEnvApp['kind']
  command: Command
  preferred: number
  envFile?: string
  flavor?: 'vite' | 'next' | 'cra'
}

// The platform is a monorepo. Starting its root dev script would also start
// unrelated services, including the scheduler; this environment uses the API.
const PLATFORM_API = { directory: 'apps/external-api', port: 3000 }

function registeredScriptCommand(root: string, script: string, extra: string[] = []): Command {
  const command = runScriptCommand(root, script, extra)
  return command.cmd === 'pnpm' ? { cmd: 'pnpm', args: ['run', script, ...extra] } : command
}

export function registeredDevApp(repo: string, root: string, catalogFile: string): RegisteredApp | string {
  const repository = activeRepositories(catalogFile).find((item) => item.alias === repo)
  if (!repository?.environments.local.enabled) return `${repo}: habilite o ambiente local em Repositórios.`
  const canonical = activeRepositoryPath(repo, catalogFile)
  const preset = repo === 'takeat-platform' ? PLATFORM_API : undefined
  const dir = preset ? join(root, preset.directory) : root
  const packageFile = join(dir, 'package.json')
  if (!existsSync(packageFile)) return `${repo}: nenhum package.json encontrado para iniciar o ambiente local.`
  const pkg: { scripts?: Record<string, unknown> } = JSON.parse(readFileSync(packageFile, 'utf8'))
  const settings = repository.environments.local
  const script = settings.startScript?.trim() || (typeof pkg.scripts?.dev === 'string' ? 'dev' : 'start')
  const scriptCommand = pkg.scripts?.[script]
  if (typeof scriptCommand !== 'string' || !scriptCommand.trim()) {
    return `${repo}: configure um script existente do package.json no ambiente local em Repositórios.`
  }
  const flavor = /\bnext\s+dev\b/.test(scriptCommand)
    ? 'next'
    : /\bvite\b/.test(scriptCommand)
      ? 'vite'
      : /\breact-scripts\s+start\b/.test(scriptCommand)
        ? 'cra'
        : undefined
  const scriptPort =
    /(?:--port|-p)(?:=|\s+)(\d+)\b/.exec(scriptCommand)?.[1] ?? /\bPORT=(\d+)\b/.exec(scriptCommand)?.[1]
  const preferred =
    settings.port ??
    preset?.port ??
    (scriptPort ? Number(scriptPort) : flavor === 'vite' ? 5173 : flavor ? 3000 : undefined)
  if (!Number.isInteger(preferred) || !preferred || preferred < 1 || preferred > 65535) {
    return `${repo}: configure a porta do ambiente local em Repositórios para confirmar quando o app estiver pronto.`
  }
  return {
    repo,
    root,
    dir,
    canonical,
    flavor,
    preferred,
    envFile: settings.envFile,
    kind: flavor ? 'frontend' : 'backend',
    // Resolve the package manager at the repository root, including when the
    // selected app is a workspace package without its own lockfile.
    command: registeredScriptCommand(root, script),
  }
}

export function registeredAppEnvironment(app: RegisteredApp): Record<string, string> {
  const result: Record<string, string> = {}
  const canonicalApp = join(app.canonical, relative(app.root, app.dir))
  // Canonical files supply local configuration for fresh worktrees. Files in
  // the task override them without copying or changing either checkout.
  for (const directory of [canonicalApp, app.dir]) {
    for (const file of ['.env', '.env.local', ...(app.envFile ? [app.envFile] : [])]) {
      const path = resolve(directory, file)
      if (existsSync(path)) Object.assign(result, parseEnvironmentVariables(readFileSync(path, 'utf8')))
    }
  }
  return result
}

export function registeredAppCommand(app: RegisteredApp, port: number): Command {
  if (!app.flavor || app.flavor === 'cra') return app.command
  const script = app.command.args[app.command.cmd === 'yarn' ? 0 : 1]
  return registeredScriptCommand(app.root, script, ['--port', String(port)])
}
