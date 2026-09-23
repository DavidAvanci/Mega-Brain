import {
  closeSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { connect } from 'node:net'
import { dirname, join } from 'node:path'
import { activeRepositoryPath, assertRegisteredWorktree, repositoryCatalogFile } from '../../repositories/catalog'
import { installCommand, lockfilesMatch, runScriptCommand, type Command } from '../../../scripts/lib/packageManager.ts'
import type { DevEnvApp, DevEnvInfo } from '../../../shared/domain/agents'
import { nodeProcessRunner, type ProcessChild, type ProcessRunner } from '../../process'
import {
  AGD,
  BACKEND_LIBS,
  BACKEND_PORT,
  CLUBE,
  CLUBE_PORT,
  FRONTENDS,
  LOCAL_API,
  LOCAL_CLUBE_API,
  type FrontendConfig,
} from './dev-env-config'
const STATE_DIR = '.dev-env'

export { FRONTENDS } from './dev-env-config'

export interface RepoClassification {
  agd: boolean
  clube: boolean
  libs: string[]
  fronts: string[]
  unknown: string[]
}

export function classifyRepos(names: string[]): RepoClassification {
  const result: RepoClassification = { agd: false, clube: false, libs: [], fronts: [], unknown: [] }
  for (const name of names) {
    if (name === AGD) result.agd = true
    else if (name === CLUBE) result.clube = true
    else if (BACKEND_LIBS.has(name)) result.libs.push(name)
    else if (FRONTENDS[name]) result.fronts.push(name)
    else result.unknown.push(name)
  }
  return result
}

// operation-takeat espera o dashboard em 3300 (VITE_PARENT_URL)
export function preferredPort(repo: string, fronts: string[]): number {
  if (repo === 'garcom-restaurant-dashboard' && fronts.includes('operation-takeat')) return 3300
  return FRONTENDS[repo].port
}

interface RepoRef {
  name: string
  dir: string
}

function git(dir: string, runner: ProcessRunner, ...args: string[]): string {
  try {
    return runner
      .execFileSync('git', ['-C', dir, ...args], { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return ''
  }
}

function isTouched(dir: string, runner: ProcessRunner): boolean {
  const branch = git(dir, runner, 'rev-parse', '--abbrev-ref', 'HEAD')
  if (!branch) return false
  return (branch !== 'master' && branch !== 'main') || git(dir, runner, 'status', '--porcelain') !== ''
}

function touchedRepos(cardPath: string, runner: ProcessRunner, catalogFile: string): RepoRef[] {
  const linksRoot = existsSync(join(cardPath, 'repos')) ? join(cardPath, 'repos') : cardPath
  return readdirSync(linksRoot, { withFileTypes: true })
    .filter((entry) => entry.isSymbolicLink())
    .flatMap((entry) => {
      let dir: string
      try {
        dir = realpathSync(join(linksRoot, entry.name))
      } catch {
        return []
      }
      if (!existsSync(join(dir, '.git'))) return []
      assertRegisteredWorktree(entry.name, dir, catalogFile)
      return isTouched(dir, runner) ? [{ name: entry.name, dir }] : []
    })
}

export interface DevEnvPlan {
  localBackend: boolean
  localClube: boolean
  backend?: { dir: string; createWorktree: boolean; canonical: string }
  clube?: { dir: string; canonical: string }
  libs: RepoRef[]
  fronts: { repo: string; dir: string; canonical: string; source: 'worktree' | 'master'; config: FrontendConfig; preferred: number }[]
  warnings: string[]
}

export function planDevEnv(
  cardPath: string,
  frontendChoice?: string,
  runner: ProcessRunner = nodeProcessRunner,
  settingsFile?: string,
): DevEnvPlan | { needsFrontend: string[] } {
  const catalogFile = repositoryCatalogFile(settingsFile)
  const touched = touchedRepos(cardPath, runner, catalogFile)
  const byName = new Map(touched.map((repo) => [repo.name, repo]))
  const { agd, clube, libs, fronts, unknown } = classifyRepos(touched.map((repo) => repo.name))
  const warnings = unknown.map((name) => `Repo não suportado pelo ambiente dev: ${name}`)
  const localBackend = agd || libs.length > 0
  if (!localBackend && !clube && !fronts.length) throw new Error('Nenhum repo tocado encontrado nos symlinks da pasta')

  let backend: DevEnvPlan['backend']
  if (localBackend) {
    const canonical = activeRepositoryPath(AGD, catalogFile)
    if (agd) backend = { dir: byName.get(AGD)!.dir, createWorktree: false, canonical }
    else {
      const sibling = join(dirname(byName.get(libs[0])!.dir), AGD)
      backend = { dir: sibling, createWorktree: !existsSync(sibling), canonical }
    }
  }

  let frontRepos: { repo: string; dir: string; canonical: string; source: 'worktree' | 'master' }[]
  if (fronts.length) {
    frontRepos = fronts.map((repo) => ({ repo, dir: byName.get(repo)!.dir, canonical: activeRepositoryPath(repo, catalogFile), source: 'worktree' as const }))
  } else {
    if (!frontendChoice) {
      const available = Object.keys(FRONTENDS).filter((repo) => {
        try { activeRepositoryPath(repo, catalogFile); return true } catch { return false }
      })
      if (!available.length) throw new Error('Cadastre e ative um frontend em Repositórios para subir o ambiente local')
      return { needsFrontend: available }
    }
    if (!FRONTENDS[frontendChoice]) throw new Error(`Frontend desconhecido: ${frontendChoice}`)
    const dir = activeRepositoryPath(frontendChoice, catalogFile)
    const branch = git(dir, runner, 'rev-parse', '--abbrev-ref', 'HEAD')
    if (branch !== 'master' && branch !== 'main') {
      warnings.push(`${frontendChoice} canônico não está na master (branch atual: ${branch})`)
    }
    frontRepos = [{ repo: frontendChoice, dir, canonical: dir, source: 'master' }]
  }

  return {
    localBackend,
    localClube: clube,
    backend,
    clube: clube ? { dir: byName.get(CLUBE)!.dir, canonical: activeRepositoryPath(CLUBE, catalogFile) } : undefined,
    libs: libs.map((name) => byName.get(name)!),
    fronts: frontRepos.map((front) => ({
      ...front,
      config: FRONTENDS[front.repo],
      preferred: preferredPort(
        front.repo,
        frontRepos.map((f) => f.repo),
      ),
    })),
    warnings,
  }
}

function apiUrlFor(config: FrontendConfig, localBackend: boolean): string | undefined {
  if (!config.apiVar) return undefined
  if (!localBackend) return config.prodUrl
  return config.prodUrl?.endsWith('/') ? `${LOCAL_API}/` : LOCAL_API
}

function clubeApiUrlFor(config: FrontendConfig, localClube: boolean): string | undefined {
  if (!config.clubeApiVar) return undefined
  return localClube ? LOCAL_CLUBE_API : config.clubeProdUrl
}

interface Run {
  aborted: boolean
  child?: ProcessChild
  childError?: Error
}

const active = new Map<string, Run>()
let wslLoginPath: string | null | undefined

function activeKey(cardPath: string): string {
  try {
    return realpathSync(cardPath)
  } catch {
    return cardPath
  }
}

function statePath(cardPath: string): string {
  return join(cardPath, STATE_DIR, 'state.json')
}

function writeState(cardPath: string, state: DevEnvInfo): void {
  mkdirSync(join(cardPath, STATE_DIR), { recursive: true })
  writeFileSync(statePath(cardPath), `${JSON.stringify(state, null, 2)}\n`)
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function killTree(pid: number): void {
  if (!pidAlive(pid)) return
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {}
  }
}

export function killRunningApps(state: DevEnvInfo, kill: (pid: number) => void = killTree): void {
  for (const app of state.apps) {
    if (typeof app.pid === 'number') kill(app.pid)
    app.pid = undefined
    if (app.status === 'erro') continue
    if (app.status !== 'aguardando') app.note = 'parado porque outro app do ambiente falhou'
    app.status = 'parado'
  }
}

function checkAborted(run: Run): void {
  if (run.aborted) throw new Error('abortado')
}

function argv(command: Command): [string, string[]] {
  return [command.cmd, command.args]
}

function processEnvironment(runner: ProcessRunner): NodeJS.ProcessEnv {
  if (!process.env.WSL_DISTRO_NAME) return process.env
  if (wslLoginPath === undefined) {
    wslLoginPath = null
    try {
      const output = String(
        runner.execFileSync('bash', ['-lic', 'printf "MEGA_BRAIN_PATH=%s\\n" "$PATH"'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }),
      )
      wslLoginPath =
        output
          .split('\n')
          .find((line) => line.startsWith('MEGA_BRAIN_PATH='))
          ?.slice('MEGA_BRAIN_PATH='.length)
          .trim() || null
    } catch {}
  }
  return wslLoginPath ? { ...process.env, PATH: wslLoginPath } : process.env
}

export function shouldInstallDependencies(dir: string, canonicalDir: string): boolean {
  return !existsSync(join(dir, 'node_modules')) || !lockfilesMatch(dir, canonicalDir)
}

export function prepareDependencies(dir: string, canonicalDir: string): boolean {
  if (!shouldInstallDependencies(dir, canonicalDir)) return false
  const modules = join(dir, 'node_modules')
  try {
    // A shared dependency tree is valid only while both lockfiles match. Do
    // not let an install for the worktree mutate the canonical checkout.
    if (lstatSync(modules).isSymbolicLink()) unlinkSync(modules)
  } catch {}
  return true
}

function step(
  run: Run,
  cwd: string,
  logFile: string,
  cmd: string,
  args: string[],
  runner: ProcessRunner,
): Promise<void> {
  checkAborted(run)
  return new Promise((done, fail) => {
    const fd = openSync(logFile, 'a')
    const child = runner.spawn(cmd, args, { cwd, stdio: ['ignore', fd, fd], env: processEnvironment(runner) })
    run.child = child
    child.on('error', (error) => {
      closeSync(fd)
      fail(error)
    })
    child.on('exit', (code) => {
      closeSync(fd)
      run.child = undefined
      if (run.aborted) fail(new Error('abortado'))
      else if (code === 0) done()
      else fail(new Error(`${cmd} ${args.join(' ')} falhou (código ${code}) — veja ${logFile}`))
    })
  })
}

function detach(
  run: Run,
  cwd: string,
  logFile: string,
  cmd: string,
  args: string[],
  env: Record<string, string>,
  runner: ProcessRunner,
): ProcessChild {
  const fd = openSync(logFile, 'a')
  const child = runner.spawn(cmd, args, {
    cwd,
    detached: true,
    stdio: ['ignore', fd, fd],
    env: { ...processEnvironment(runner), ...env },
  })
  child.on('error', (error) => {
    run.childError = error
    console.error(`${cmd}:`, error.message)
  })
  child.unref()
  closeSync(fd)
  return child
}

function tryConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host: '127.0.0.1' })
    const finish = (ok: boolean) => {
      socket.destroy()
      resolve(ok)
    }
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.setTimeout(1000, () => finish(false))
  })
}

async function portFree(port: number): Promise<boolean> {
  return !(await tryConnect(port))
}

async function findFreePort(preferred: number, used: Set<number>): Promise<number> {
  for (let port = preferred; port < preferred + 50; port++) {
    if (!used.has(port) && (await portFree(port))) {
      used.add(port)
      return port
    }
  }
  throw new Error(`Nenhuma porta livre a partir de ${preferred}`)
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitPort(port: number, run: Run, logFile: string, timeoutMs = 300_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    checkAborted(run)
    if (run.childError) throw run.childError
    if (run.child && (run.child.exitCode !== null || run.child.signalCode !== null)) {
      throw new Error(`O processo encerrou antes da porta ${port} responder — veja ${logFile}`)
    }
    if (await tryConnect(port)) return
    await sleep(1500)
  }
  throw new Error(`Timeout esperando a porta ${port} responder`)
}

async function orchestrate(
  cardPath: string,
  run: Run,
  state: DevEnvInfo,
  plan: DevEnvPlan,
  runner: ProcessRunner,
): Promise<void> {
  const logDir = join(cardPath, STATE_DIR)
  const update = () => writeState(cardPath, state)
  let current: DevEnvApp | undefined
  try {
    if (plan.backend) {
      const app = state.apps.find((a) => a.repo === AGD)!
      current = app
      state.phase = 'Preparando infra'
      update()
      await step(
        run,
        cardPath,
        join(logDir, 'docker.log'),
        'docker',
        ['start', 'takeat_db', 'takeat_redis'],
        runner,
      ).catch(() => {
        throw new Error('Docker: não consegui subir takeat_db/takeat_redis')
      })
      if (!(await portFree(BACKEND_PORT))) {
        throw new Error(`Porta ${BACKEND_PORT} já está ocupada — outro backend rodando?`)
      }
      if (plan.backend.createWorktree) {
        state.phase = `Criando worktree do ${AGD}`
        update()
        await step(
          run,
          plan.backend.canonical,
          join(logDir, 'worktree.log'),
          'git',
          ['worktree', 'add', '--detach', plan.backend.dir, 'master'],
          runner,
        )
      }
      for (const lib of plan.libs) {
        state.phase = `Buildando ${lib.name}`
        update()
        if (!existsSync(join(lib.dir, 'node_modules'))) {
          await step(run, lib.dir, join(logDir, `${lib.name}.log`), ...argv(installCommand(lib.dir)), runner)
        }
        await step(run, lib.dir, join(logDir, `${lib.name}.log`), ...argv(runScriptCommand(lib.dir, 'build')), runner)
      }
      const envFile = join(plan.backend.dir, '.env')
      const localEnvFile = join(plan.backend.canonical, '.env.local')
      const sourceEnvFile = existsSync(localEnvFile) ? localEnvFile : join(plan.backend.canonical, '.env')
      if (existsSync(sourceEnvFile)) copyFileSync(sourceEnvFile, envFile)
      state.phase = undefined
      if (prepareDependencies(plan.backend.dir, plan.backend.canonical)) {
        app.status = 'instalando'
        update()
        await step(run, plan.backend.dir, join(logDir, `${AGD}.log`), ...argv(installCommand(plan.backend.dir)), runner)
      }
      checkAborted(run)
      app.status = 'subindo'
      const logFile = join(logDir, `${AGD}.log`)
      run.child = detach(
        run,
        plan.backend.dir,
        logFile,
        ...argv(runScriptCommand(plan.backend.dir, 'dev')),
        { PORT: String(BACKEND_PORT) },
        runner,
      )
      app.pid = run.child.pid
      update()
      await waitPort(BACKEND_PORT, run, logFile)
      run.child = undefined
      app.status = 'rodando'
      update()
    }
    if (plan.clube) {
      const app = state.apps.find((a) => a.repo === CLUBE)!
      current = app
      state.phase = 'Preparando infra do Clube'
      update()
      await step(
        run,
        cardPath,
        join(logDir, 'docker.log'),
        'docker',
        ['start', 'database_clube_clientes', 'takeat_redis'],
        runner,
      ).catch(() => {
        throw new Error('Docker: não consegui subir database_clube_clientes/takeat_redis')
      })
      if (!(await portFree(CLUBE_PORT))) {
        throw new Error(`Porta ${CLUBE_PORT} já está ocupada — outro api-clube rodando?`)
      }
      const envFile = join(plan.clube.dir, '.env')
      const localEnvFile = join(plan.clube.canonical, '.env.local')
      const sourceEnvFile = existsSync(localEnvFile) ? localEnvFile : join(plan.clube.canonical, '.env')
      if (existsSync(sourceEnvFile)) copyFileSync(sourceEnvFile, envFile)
      state.phase = undefined
      if (prepareDependencies(plan.clube.dir, plan.clube.canonical)) {
        app.status = 'instalando'
        update()
        await step(run, plan.clube.dir, join(logDir, `${CLUBE}.log`), ...argv(installCommand(plan.clube.dir)), runner)
      }
      checkAborted(run)
      app.status = 'subindo'
      const logFile = join(logDir, `${CLUBE}.log`)
      run.child = detach(
        run,
        plan.clube.dir,
        logFile,
        ...argv(runScriptCommand(plan.clube.dir, 'dev')),
        { PORT: String(CLUBE_PORT) },
        runner,
      )
      app.pid = run.child.pid
      update()
      await waitPort(CLUBE_PORT, run, logFile)
      run.child = undefined
      app.status = 'rodando'
      update()
    }
    const used = new Set<number>([BACKEND_PORT, CLUBE_PORT])
    for (const front of plan.fronts) {
      checkAborted(run)
      const app = state.apps.find((a) => a.repo === front.repo)!
      current = app
      const canonicalFront = front.canonical
      if (prepareDependencies(front.dir, canonicalFront)) {
        app.status = 'instalando'
        update()
        await step(run, front.dir, join(logDir, `${front.repo}.log`), ...argv(installCommand(front.dir)), runner)
      }
      const port = await findFreePort(front.preferred, used)
      app.port = port
      app.url = `http://localhost:${port}`
      const env: Record<string, string> = { PORT: String(port) }
      if (app.apiUrl && front.config.apiVar) env[front.config.apiVar] = app.apiUrl
      if (app.clubeApiUrl && front.config.clubeApiVar) env[front.config.clubeApiVar] = app.clubeApiUrl
      if (front.repo === 'new-delivery-takeat' && plan.localBackend) {
        app.note = 'ajuste o .env.local manualmente para apontar pro backend local'
      }
      const extra = front.config.flavor === 'cra' ? [] : ['--port', String(port)]
      checkAborted(run)
      app.status = 'subindo'
      const logFile = join(logDir, `${front.repo}.log`)
      run.child = detach(
        run,
        front.dir,
        logFile,
        ...argv(runScriptCommand(front.dir, front.config.script, extra)),
        env,
        runner,
      )
      app.pid = run.child.pid
      update()
      await waitPort(port, run, logFile)
      run.child = undefined
      app.status = 'rodando'
      update()
    }
    state.phase = undefined
    state.status = 'rodando'
    update()
  } catch (error) {
    if (run.aborted) return
    state.status = 'erro'
    state.phase = undefined
    state.error = error instanceof Error ? error.message : String(error)
    if (current) current.status = 'erro'
    killRunningApps(state)
    update()
  }
}

export function startDevEnv(
  cardPath: string,
  frontendChoice?: string,
  runner: ProcessRunner = nodeProcessRunner,
  settingsFile?: string,
): { needsFrontend?: string[] } {
  const key = activeKey(cardPath)
  const current = readDevEnv(cardPath)?.status
  if (active.has(key) || current === 'subindo') throw new Error('O ambiente já está subindo')
  if (current === 'rodando') {
    throw new Error('O ambiente já está rodando — pare antes de subir de novo')
  }
  const plan = planDevEnv(cardPath, frontendChoice, runner, settingsFile)
  if ('needsFrontend' in plan) return plan
  const handle: Run = { aborted: false }
  active.set(key, handle)
  const state: DevEnvInfo = {
    status: 'subindo',
    ownerPid: process.pid,
    startedAt: new Date().toISOString(),
    warnings: plan.warnings.length ? plan.warnings : undefined,
    apps: [
      ...(plan.backend
        ? [
            {
              repo: AGD,
              kind: 'backend',
              source: plan.backend.createWorktree ? 'master' : 'worktree',
              port: BACKEND_PORT,
              url: LOCAL_API,
              status: 'aguardando',
            } satisfies DevEnvApp,
          ]
        : []),
      ...(plan.clube
        ? [
            {
              repo: CLUBE,
              kind: 'backend',
              source: 'worktree',
              port: CLUBE_PORT,
              url: LOCAL_CLUBE_API,
              status: 'aguardando',
            } satisfies DevEnvApp,
          ]
        : []),
      ...plan.fronts.map(
        (front) =>
          ({
            repo: front.repo,
            kind: 'frontend',
            source: front.source,
            apiUrl: apiUrlFor(front.config, plan.localBackend),
            clubeApiUrl: clubeApiUrlFor(front.config, plan.localClube),
            status: 'aguardando',
          }) satisfies DevEnvApp,
      ),
    ],
  }
  writeState(cardPath, state)
  void orchestrate(cardPath, handle, state, plan, runner).finally(() => {
    // A stopped run may still be unwinding while a replacement run is
    // registered for the same card. Never let the old run delete the newer
    // handle, otherwise the board reports that the live startup died.
    if (active.get(key) === handle) active.delete(key)
  })
  return {}
}

export function readDevEnv(cardPath: string): DevEnvInfo | null {
  const file = statePath(cardPath)
  if (!existsSync(file)) return null
  let state: DevEnvInfo
  try {
    state = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
  const key = activeKey(cardPath)
  const orchestrating =
    active.has(key) || (state.ownerPid !== undefined && state.ownerPid !== process.pid && pidAlive(state.ownerPid))
  let changed = false
  for (const app of state.apps) {
    if (app.status === 'rodando' && typeof app.pid === 'number' && !pidAlive(app.pid)) {
      app.status = 'erro'
      app.note = 'o processo caiu'
      changed = true
    }
  }
  if (state.status === 'subindo' && !orchestrating) {
    state.status = 'erro'
    state.error = 'Startup interrompido (o processo que subiu o ambiente morreu)'
    changed = true
  }
  if (state.status === 'rodando' && state.apps.some((app) => app.status === 'erro')) {
    state.status = 'erro'
    state.error = state.error ?? 'Um dos apps caiu'
    changed = true
  }
  if (changed && state.status === 'erro') killRunningApps(state)
  if (changed) writeState(cardPath, state)
  return state
}

export function stopDevEnv(cardPath: string): void {
  const key = activeKey(cardPath)
  const run = active.get(key)
  if (run) {
    run.aborted = true
    if (run.child?.pid) {
      try {
        process.kill(run.child.pid, 'SIGTERM')
      } catch {}
    }
    active.delete(key)
  }
  const file = statePath(cardPath)
  if (!existsSync(file)) return
  let state: DevEnvInfo
  try {
    state = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return
  }
  for (const app of state.apps) {
    if (typeof app.pid === 'number') killTree(app.pid)
    app.pid = undefined
    app.status = 'parado'
  }
  state.status = 'parado'
  state.ownerPid = undefined
  state.phase = undefined
  state.error = undefined
  writeState(cardPath, state)
}
