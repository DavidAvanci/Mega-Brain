import { existsSync, lstatSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
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
  services?: { name: string; port: number }[]
}

const PLATFORM_APIS = [
  { name: 'external-api', port: 3100 },
  { name: 'operation-api', port: 3300 },
  { name: 'auth-api', port: 3400 },
  { name: 'manager-api', port: 3500 },
]

function platformServices(root: string, canonical: string): { name: string; port: number }[] {
  return PLATFORM_APIS.filter((service) => existsSync(join(root, 'apps', service.name, 'package.json'))).map(
    (service) => {
      let port = service.port
      for (const directory of [canonical, root]) {
        const path = join(directory, 'apps', service.name, '.env')
        if (!existsSync(path)) continue
        const configured = Number(parseEnvironmentVariables(readFileSync(path, 'utf8')).PORT)
        if (Number.isInteger(configured) && configured > 0 && configured <= 65535) port = configured
      }
      return { name: service.name, port }
    },
  )
}

// Each API reads its own local configuration. Never share PORT across Turbo's
// children, or they will all try to listen on the external API's port.
export function prepareRegisteredApp(app: RegisteredApp, port: number): void {
  if (!app.services) return
  for (const service of app.services) {
    const directory = join(app.root, 'apps', service.name)
    for (const file of ['.env', '.env.local']) {
      const target = join(directory, file)
      const source = join(app.canonical, 'apps', service.name, file)
      if (!existsSync(target) && existsSync(source)) {
        writeFileSync(target, readFileSync(source), { mode: 0o600, flag: 'wx' })
      }
    }
    if (service.name !== 'external-api') continue
    const target = join(directory, '.env')
    const text = existsSync(target) ? readFileSync(target, 'utf8') : ''
    const next = /^\s*(?:export\s+)?PORT\s*=.*$/m.test(text)
      ? text.replace(/^\s*(?:export\s+)?PORT\s*=.*$/m, `PORT=${port}`)
      : `${text.trimEnd()}\nPORT=${port}\n`
    if (next !== text) {
      // A linked .env must become task-local before changing its port.
      if (existsSync(target) && lstatSync(target).isSymbolicLink()) unlinkSync(target)
      writeFileSync(target, next, { mode: 0o600 })
    }
  }
}

function registeredScriptCommand(root: string, script: string, extra: string[] = []): Command {
  const command = runScriptCommand(root, script, extra)
  return command.cmd === 'pnpm' ? { cmd: 'pnpm', args: ['run', script, ...extra] } : command
}

export function registeredDevApp(repo: string, root: string, catalogFile: string): RegisteredApp | string {
  const repository = activeRepositories(catalogFile).find((item) => item.alias === repo)
  if (!repository?.environments.local.enabled) return `${repo}: habilite o ambiente local em Repositórios.`
  const canonical = activeRepositoryPath(repo, catalogFile)
  const dir = root
  const packageFile = join(dir, 'package.json')
  if (!existsSync(packageFile)) return `${repo}: nenhum package.json encontrado para iniciar o ambiente local.`
  const pkg: { scripts?: Record<string, unknown> } = JSON.parse(readFileSync(packageFile, 'utf8'))
  const settings = repository.environments.local
  const script = settings.startScript?.trim() || (typeof pkg.scripts?.dev === 'string' ? 'dev' : 'start')
  const scriptCommand = pkg.scripts?.[script]
  if (typeof scriptCommand !== 'string' || !scriptCommand.trim()) {
    return `${repo}: configure um script existente do package.json no ambiente local em Repositórios.`
  }
  const services = repo === 'takeat-platform' && script === 'dev' ? platformServices(root, canonical) : undefined
  if (services && !services.some((service) => service.name === 'external-api')) {
    return `${repo}: apps/external-api não encontrado no monorepo.`
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
    services?.find((service) => service.name === 'external-api')?.port ??
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
    services,
    // Resolve the package manager at the repository root, including when the
    // selected app is a workspace package without its own lockfile.
    command: registeredScriptCommand(
      root,
      script,
      services?.map((service) => `--filter=${service.name}`),
    ),
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
