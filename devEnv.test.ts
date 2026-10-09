import { execFile, execFileSync, spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import type { DevEnvInfo } from './shared/domain/agents'
import type { ProcessRunner } from './server/process'
import { registeredAppCommand } from './server/modules/dev-environments/dev-env-apps'
import { parseDevEnvOptions } from './server/modules/dev-environments/dev-env-options'
import {
  classifyRepos,
  killRunningApps,
  planDevEnv,
  preferredPort,
  prepareDependencies,
  previewDevEnv,
  readDevEnv,
  shouldInstallDependencies,
  startDevEnv,
  stopDevEnv,
} from './server/modules/dev-environments/dev-env'

const cardFixtures: string[] = []
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!
afterEach(() => {
  Object.defineProperty(process, 'platform', originalPlatform)
  vi.unstubAllEnvs()
  for (const root of cardFixtures.splice(0)) rmSync(root, { recursive: true, force: true })
})

test('classifyRepos', () => {
  expect(classifyRepos(['api-garcom-digital', 'api-core', 'operation-takeat', 'api-clube', 'gym-app'])).toEqual({
    agd: true,
    clube: true,
    libs: ['api-core'],
    fronts: ['operation-takeat'],
    unknown: ['gym-app'],
  })
  expect(classifyRepos([])).toEqual({ agd: false, clube: false, libs: [], fronts: [], unknown: [] })
})

test('preferredPort aplica a regra do 3300', () => {
  expect(preferredPort('garcom-restaurant-dashboard', ['garcom-restaurant-dashboard'])).toBe(3000)
  expect(preferredPort('garcom-restaurant-dashboard', ['garcom-restaurant-dashboard', 'operation-takeat'])).toBe(3300)
  expect(preferredPort('operation-takeat', ['garcom-restaurant-dashboard', 'operation-takeat'])).toBe(3000)
  expect(preferredPort('manager-area', ['manager-area'])).toBe(5173)
})

test('não reinstala dependências quando node_modules existe e os lockfiles são iguais', () => {
  const root = mkdtempSync(join(tmpdir(), 'devenv-deps-'))
  const canonical = join(root, 'canonical')
  const worktree = join(root, 'worktree')
  mkdirSync(join(canonical, 'node_modules'), { recursive: true })
  mkdirSync(join(worktree, 'node_modules'), { recursive: true })
  writeFileSync(join(canonical, 'package-lock.json'), '{"lockfileVersion":3}')
  writeFileSync(join(worktree, 'package-lock.json'), '{"lockfileVersion":3}')

  expect(shouldInstallDependencies(worktree, canonical)).toBe(false)
  writeFileSync(join(worktree, 'package-lock.json'), '{"lockfileVersion":2}')
  expect(shouldInstallDependencies(worktree, canonical)).toBe(true)
})

test('instala dependências quando node_modules não existe', () => {
  const root = mkdtempSync(join(tmpdir(), 'devenv-deps-'))
  const canonical = join(root, 'canonical')
  const worktree = join(root, 'worktree')
  mkdirSync(canonical)
  mkdirSync(worktree)
  writeFileSync(join(canonical, 'package-lock.json'), '{}')
  writeFileSync(join(worktree, 'package-lock.json'), '{}')

  expect(shouldInstallDependencies(worktree, canonical)).toBe(true)
})

test('desvincula node_modules compartilhado quando os lockfiles divergem', () => {
  const root = mkdtempSync(join(tmpdir(), 'devenv-stale-deps-'))
  const canonical = join(root, 'canonical')
  const worktree = join(root, 'worktree')
  mkdirSync(join(canonical, 'node_modules'), { recursive: true })
  mkdirSync(worktree)
  writeFileSync(join(canonical, 'package-lock.json'), '{"version":1}')
  writeFileSync(join(worktree, 'package-lock.json'), '{"version":2}')
  symlinkSync(
    join(canonical, 'node_modules'),
    join(worktree, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )

  expect(prepareDependencies(worktree, canonical)).toBe(true)
  expect(() => realpathSync(join(worktree, 'node_modules'))).toThrow()
})

function fakeRepo(root: string, name: string, branch: string): string {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  execFileSync('git', ['-C', dir, 'init', '-q', '-b', 'test-fixture'])
  execFileSync('git', ['-C', dir, 'commit', '-q', '--allow-empty', '-m', 'init'], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t',
    },
  })
  execFileSync('git', ['-C', dir, 'branch', '-m', branch])
  return dir
}

function cardWith(repos: { name: string; branch: string }[], linksDir = ''): string {
  const root = mkdtempSync(join(tmpdir(), 'devenv-'))
  cardFixtures.push(root)
  const worktrees = join(root, 'worktrees')
  const card = join(root, 'card')
  const links = join(card, linksDir)
  mkdirSync(links, { recursive: true })
  for (const repo of repos) {
    symlinkSync(
      fakeRepo(worktrees, repo.name, repo.branch),
      join(links, repo.name),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
  }
  // Tests must use their own active catalog, never the developer's settings.
  const names = new Set([
    ...repos.map((repo) => repo.name),
    'api-garcom-digital',
    'manager-area',
    'garcom-restaurant-dashboard',
    'internal-dashboard',
  ])
  const repositories = [...names].map((alias) => ({
    id: alias,
    alias,
    active: true,
    path: repos.some((repo) => repo.name === alias)
      ? join(worktrees, alias)
      : fakeRepo(join(root, 'canonical'), alias, 'master'),
    environments: { local: { enabled: true }, staging: { enabled: false }, prod: { enabled: false } },
  }))
  writeFileSync(join(root, 'repositories.json'), JSON.stringify({ version: 1, repositories }))
  vi.stubEnv('MEGA_BRAIN_SETTINGS_FILE', join(root, 'settings.json'))
  return card
}

test('planDevEnv: só frontend aponta para produção', () => {
  const card = cardWith([{ name: 'operation-takeat', branch: 'ESTR-1' }])
  const plan = planDevEnv(card)
  expect(plan).toMatchObject({
    localBackend: false,
    backend: undefined,
    fronts: [{ repo: 'operation-takeat', source: 'worktree', preferred: 3000 }],
  })
})

test('planDevEnv: front + back rodam do worktree', () => {
  const card = cardWith([
    { name: 'api-garcom-digital', branch: 'ESTR-2' },
    { name: 'garcom-restaurant-dashboard', branch: 'ESTR-2' },
    { name: 'operation-takeat', branch: 'ESTR-2' },
  ])
  const plan = planDevEnv(card)
  expect(plan).toMatchObject({ localBackend: true, backend: { createWorktree: false } })
  if ('needsFrontend' in plan) throw new Error('inesperado')
  expect(plan.fronts.find((f) => f.repo === 'garcom-restaurant-dashboard')?.preferred).toBe(3300)
})

test('planDevEnv: repo na master sem diff não conta como tocado', () => {
  const card = cardWith([
    { name: 'operation-takeat', branch: 'ESTR-3' },
    { name: 'manager-area', branch: 'master' },
  ])
  const plan = planDevEnv(card)
  if ('needsFrontend' in plan) throw new Error('inesperado')
  expect(plan.fronts.map((f) => f.repo)).toEqual(['operation-takeat'])
})

test('planDevEnv: só backend pede escolha de frontend', () => {
  const card = cardWith([{ name: 'api-garcom-digital', branch: 'ESTR-4' }])
  const plan = planDevEnv(card)
  expect(plan).toHaveProperty('needsFrontend')
  const withChoice = planDevEnv(card, 'garcom-restaurant-dashboard')
  expect(withChoice).toMatchObject({
    localBackend: true,
    fronts: [{ repo: 'garcom-restaurant-dashboard', source: 'master', preferred: 3000 }],
  })
})

test('planDevEnv: lib tocada usa agd irmão (criando worktree se faltar)', () => {
  const card = cardWith([{ name: 'api-core', branch: 'ESTR-5' }])
  const plan = planDevEnv(card, 'manager-area')
  if ('needsFrontend' in plan) throw new Error('inesperado')
  expect(plan.backend?.createWorktree).toBe(true)
  expect(plan.backend?.dir.endsWith('/api-garcom-digital')).toBe(true)
  expect(plan.libs.map((lib) => lib.name)).toEqual(['api-core'])
})

test('planDevEnv: api-clube tocado roda o clube local sem backend principal', () => {
  const card = cardWith([
    { name: 'api-clube', branch: 'ESTR-457' },
    { name: 'internal-dashboard', branch: 'ESTR-457' },
  ])
  const plan = planDevEnv(card)
  if ('needsFrontend' in plan) throw new Error('inesperado')
  expect(plan.localBackend).toBe(false)
  expect(plan.localClube).toBe(true)
  expect(plan.clube?.dir.endsWith('/api-clube')).toBe(true)
  expect(plan.warnings).toEqual([])
  expect(plan.fronts.map((f) => f.repo)).toEqual(['internal-dashboard'])
})

test('planDevEnv: só api-clube pede escolha de frontend', () => {
  const card = cardWith([{ name: 'api-clube', branch: 'ESTR-457' }])
  const plan = planDevEnv(card)
  expect(plan).toHaveProperty('needsFrontend')
  const withChoice = planDevEnv(card, 'internal-dashboard')
  expect(withChoice).toMatchObject({
    localBackend: false,
    localClube: true,
    fronts: [{ repo: 'internal-dashboard', source: 'master', preferred: 5180 }],
  })
})

test('planDevEnv: symlinks em repos/ são encontrados', () => {
  const card = cardWith(
    [
      { name: 'api-garcom-digital', branch: 'ESTR-1' },
      { name: 'operation-takeat', branch: 'ESTR-1' },
    ],
    'repos',
  )
  expect(planDevEnv(card)).toMatchObject({
    localBackend: true,
    fronts: [{ repo: 'operation-takeat', source: 'worktree' }],
  })
})

test('planDevEnv: nada tocado é erro', () => {
  const card = cardWith([])
  expect(() => planDevEnv(card)).toThrow('Nenhum repositório alterado')
})

test('prévia no macOS dispensa Docker e frontend obrigatório sem iniciar processos', () => {
  Object.defineProperty(process, 'platform', { value: 'darwin' })
  const card = cardWith([{ name: 'api-garcom-digital', branch: 'fix/backend' }])
  const preview = previewDevEnv(card)
  expect(preview).toMatchObject({
    docker: false,
    platform: 'darwin',
  })
  expect(preview.projects.filter((project) => project.selected)).toMatchObject([
    { repo: 'api-garcom-digital', port: 3333, selected: true },
  ])
  expect(preview.projects.find((project) => project.repo === 'manager-area')).toMatchObject({
    source: 'master',
    selected: false,
  })
  expect(existsSync(join(card, '.dev-env'))).toBe(false)
  Object.defineProperty(process, 'platform', { value: 'linux' })
  expect(previewDevEnv(card).docker).toBe(true)
})

test('prévia evita portas padrão repetidas entre projetos selecionados', () => {
  const card = cardWith([
    { name: 'operation-takeat', branch: 'fix/front' },
    { name: 'new-delivery-takeat', branch: 'fix/front' },
  ])
  const preview = previewDevEnv(card)
  expect(preview.projects.map((project) => project.port)).toEqual([3000, 3001])
})

test('configuração inválida é rejeitada antes de escrever estado ou iniciar processos', () => {
  const card = cardWith([{ name: 'api-garcom-digital', branch: 'fix/backend' }])
  for (const value of [
    null,
    {},
    { docker: false, projects: [] },
    { docker: 'false', projects: [] },
    { docker: false, projects: [{ repo: 'api-garcom-digital', port: 0 }] },
    { docker: false, projects: [{ repo: 'api-garcom-digital', port: 3000.5 }] },
    { docker: false, projects: [{ repo: 'api-garcom-digital', port: 70000 }] },
    {
      docker: false,
      projects: [
        { repo: 'api-garcom-digital', port: 3000 },
        { repo: 'api-clube', port: 3000 },
      ],
    },
    {
      docker: false,
      projects: [
        { repo: 'api-garcom-digital', port: 3000 },
        { repo: 'api-garcom-digital', port: 3001 },
      ],
    },
  ])
    expect(() => parseDevEnvOptions(value)).toThrow()
  expect(() =>
    startDevEnv(card, undefined, undefined, undefined, { docker: false, projects: [{ repo: 'unknown', port: 4100 }] }),
  ).toThrow('Projeto indisponível')
  expect(existsSync(join(card, '.dev-env'))).toBe(false)
})

async function unusedPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Porta não disponível')
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return address.port
}

function simulatedApps(card: string) {
  const calls: { command: string; args: readonly string[]; port?: string; directory?: string }[] = []
  const children = new Set<ReturnType<typeof spawn>>()
  const runner: ProcessRunner = {
    execFileSync(command, args, options) {
      return execFileSync(command, [...args], options)
    },
    execFile(command, args, options, callback) {
      execFile(command, [...args], options, (error, stdout, stderr) =>
        callback(error, String(stdout ?? ''), String(stderr ?? '')),
      )
    },
    spawn(command, args, options) {
      calls.push({ command, args, port: options?.env?.PORT, directory: String(options?.cwd ?? '') })
      const script = options?.detached
        ? "require('node:net').createServer(socket => socket.end()).listen(Number(process.env.PORT), '127.0.0.1')"
        : 'process.exit(0)'
      const child = spawn(process.execPath, ['-e', script], options)
      children.add(child)
      child.once('exit', () => children.delete(child))
      return child
    },
  }
  return {
    runner,
    calls,
    stop() {
      stopDevEnv(card)
      for (const child of children) child.kill('SIGKILL')
    },
  }
}

async function waitForStartup(card: string) {
  for (let attempt = 0; attempt < 100 && readDevEnv(card)?.status === 'subindo'; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  expect(readDevEnv(card)?.status).toBe('rodando')
}

test('inicia só projetos selecionados com portas escolhidas e preserva escolhas na prévia', async () => {
  const card = cardWith([
    { name: 'api-garcom-digital', branch: 'fix/backend' },
    { name: 'api-clube', branch: 'fix/backend' },
    { name: 'operation-takeat', branch: 'fix/frontend' },
  ])
  const port = await unusedPort()
  const { runner, calls, stop } = simulatedApps(card)
  const configuration = { docker: false, projects: [{ repo: 'api-clube', port }] }
  try {
    expect(startDevEnv(card, undefined, runner, undefined, configuration)).toEqual({})
    await waitForStartup(card)
    expect(readDevEnv(card)).toMatchObject({ configuration, apps: [{ repo: 'api-clube', port }] })
    expect(readDevEnv(card)?.apps).toHaveLength(1)
    expect(calls.some((call) => call.command === 'docker')).toBe(false)
    expect(calls.filter((call) => call.port).map((call) => call.port)).toEqual([String(port)])
    stop()
    expect(previewDevEnv(card).projects.filter((project) => project.selected)).toMatchObject([
      { repo: 'api-clube', port },
    ])
  } finally {
    stop()
  }
}, 15_000)

test('portas dos backends escolhidas atualizam URLs dos frontends e Docker exige opção explícita', async () => {
  Object.defineProperty(process, 'platform', { value: 'darwin' })
  const card = cardWith([
    { name: 'api-garcom-digital', branch: 'fix/backend' },
    { name: 'api-clube', branch: 'fix/backend' },
    { name: 'internal-dashboard', branch: 'fix/frontend' },
  ])
  const backendPort = await unusedPort()
  let clubePort = await unusedPort()
  while (clubePort === backendPort) clubePort = await unusedPort()
  let frontPort = await unusedPort()
  while ([backendPort, clubePort].includes(frontPort)) frontPort = await unusedPort()
  const { runner, calls, stop } = simulatedApps(card)
  try {
    startDevEnv(card, undefined, runner, undefined, {
      docker: true,
      projects: [
        { repo: 'api-garcom-digital', port: backendPort },
        { repo: 'api-clube', port: clubePort },
        { repo: 'internal-dashboard', port: frontPort },
      ],
    })
    await waitForStartup(card)
    expect(readDevEnv(card)?.apps.find((app) => app.repo === 'internal-dashboard')).toMatchObject({
      port: frontPort,
      apiUrl: `http://localhost:${backendPort}`,
      clubeApiUrl: `http://localhost:${clubePort}`,
    })
    expect(calls.filter((call) => call.command === 'docker').map((call) => call.args)).toEqual([
      ['start', 'takeat_db', 'takeat_redis'],
      ['start', 'database_clube_clientes', 'takeat_redis'],
    ])
  } finally {
    stop()
  }
}, 15_000)

test('porta ocupada falha antes de Docker, installs ou processos e não muda a porta escolhida', async () => {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Porta não disponível')
  const card = cardWith([{ name: 'api-garcom-digital', branch: 'fix/backend' }])
  const { runner, calls, stop } = simulatedApps(card)
  try {
    startDevEnv(card, undefined, runner, undefined, {
      docker: true,
      projects: [{ repo: 'api-garcom-digital', port: address.port }],
    })
    for (let attempt = 0; attempt < 20 && readDevEnv(card)?.status === 'subindo'; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 50))
    expect(readDevEnv(card)).toMatchObject({ status: 'erro', apps: [{ port: address.port }] })
    expect(readDevEnv(card)?.error).toContain(`porta ${address.port} já está ocupada`)
    expect(calls).toEqual([])
  } finally {
    stop()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('planDevEnv: docs Next cadastradas rodam mesmo fora da lista legada', () => {
  const card = cardWith(
    [
      { name: 'external-api-docs', branch: 'fix/docs' },
      { name: 'dev-docs', branch: 'fix/docs' },
    ],
    'repos',
  )
  for (const [repo, port] of [
    ['external-api-docs', 5201],
    ['dev-docs', 5200],
  ] as const) {
    writeFileSync(
      join(card, 'repos', repo, 'package.json'),
      JSON.stringify({ packageManager: 'pnpm@10', scripts: { dev: `next dev --port=${port}` } }),
    )
  }
  const plan = planDevEnv(card)
  if ('needsFrontend' in plan) throw new Error('docs não exigem frontend legado')
  expect(plan.warnings).toEqual([])
  expect(plan.fronts).toEqual([])
  expect(
    plan.apps.map((app) => ({
      repo: app.repo,
      port: app.preferred,
      command: registeredAppCommand(app, app.preferred + 1),
    })),
  ).toEqual([
    { repo: 'dev-docs', port: 5200, command: { cmd: 'pnpm', args: ['run', 'dev', '--port', '5201'] } },
    { repo: 'external-api-docs', port: 5201, command: { cmd: 'pnpm', args: ['run', 'dev', '--port', '5202'] } },
  ])
})

test('planDevEnv: platform inicia só a API externa, com pnpm do monorepo', () => {
  const card = cardWith([{ name: 'takeat-platform', branch: 'fix/api' }], 'repos')
  const root = realpathSync(join(card, 'repos', 'takeat-platform'))
  mkdirSync(join(root, 'apps/external-api'), { recursive: true })
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ packageManager: 'pnpm@10', scripts: { dev: 'turbo run dev' } }),
  )
  writeFileSync(
    join(root, 'apps/external-api/package.json'),
    JSON.stringify({ scripts: { dev: 'nest start --watch' } }),
  )
  const plan = planDevEnv(card)
  expect(plan).toMatchObject({
    localBackend: false,
    fronts: [],
    warnings: [],
    apps: [
      {
        repo: 'takeat-platform',
        dir: join(root, 'apps/external-api'),
        kind: 'backend',
        preferred: 3000,
        command: { cmd: 'pnpm', args: ['run', 'dev'] },
      },
    ],
  })
})

test('planDevEnv: respeita script e porta configurados de um repo customizado', () => {
  const card = cardWith([{ name: 'custom-api', branch: 'fix/api' }])
  writeFileSync(
    join(card, 'custom-api', 'package.json'),
    JSON.stringify({ scripts: { 'dev:local': 'node server.mjs' } }),
  )
  const file = join(dirname(card), 'repositories.json')
  const catalog = JSON.parse(readFileSync(file, 'utf8'))
  catalog.repositories.find((repo: { alias: string }) => repo.alias === 'custom-api').environments.local = {
    enabled: true,
    startScript: 'dev:local',
    port: 4100,
  }
  writeFileSync(file, JSON.stringify(catalog))
  expect(planDevEnv(card)).toMatchObject({
    apps: [{ repo: 'custom-api', preferred: 4100, command: { cmd: 'npm', args: ['run', 'dev:local'] } }],
    warnings: [],
  })
})

test('planDevEnv: repo encontrado sem configuração tem diagnóstico acionável', () => {
  const card = cardWith([{ name: 'custom-api', branch: 'fix/api' }])
  writeFileSync(join(card, 'custom-api', 'package.json'), JSON.stringify({ scripts: { dev: 'node server.mjs' } }))
  expect(() => planDevEnv(card)).toThrow('custom-api: configure a porta do ambiente local em Repositórios')
})

test('app cadastrado inicia na worktree, confirma a porta e para sem persistir variáveis locais', async () => {
  const card = cardWith([{ name: 'custom-api', branch: 'fix/api' }], 'repos')
  const root = realpathSync(join(card, 'repos', 'custom-api'))
  const reservation = createServer()
  await new Promise<void>((resolve, reject) => {
    reservation.once('error', reject)
    reservation.listen(0, '127.0.0.1', resolve)
  })
  const address = reservation.address()
  if (!address || typeof address === 'string') throw new Error('porta não disponível')
  const port = address.port
  await new Promise<void>((resolve) => reservation.close(() => resolve()))
  const catalogFile = join(dirname(card), 'repositories.json')
  const catalog = JSON.parse(readFileSync(catalogFile, 'utf8'))
  catalog.repositories.find((repo: { alias: string }) => repo.alias === 'custom-api').environments.local.port = port
  writeFileSync(catalogFile, JSON.stringify(catalog))
  mkdirSync(join(root, 'node_modules'))
  writeFileSync(join(root, 'package-lock.json'), '{}')
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { dev: 'node worker.mjs' } }))
  writeFileSync(join(root, '.env.local'), 'LOCAL_SETTING=fixture-value\n')
  writeFileSync(
    join(root, 'worker.mjs'),
    `
    import { createServer } from 'node:net';
    import { writeFileSync } from 'node:fs';
    writeFileSync('observed.json', JSON.stringify({ directory: process.cwd(), setting: process.env.LOCAL_SETTING }));
    createServer(socket => socket.end()).listen(Number(process.env.PORT), '127.0.0.1');
  `,
  )
  try {
    expect(startDevEnv(card)).toEqual({})
    for (let attempt = 0; attempt < 60 && readDevEnv(card)?.status === 'subindo'; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    expect(readDevEnv(card)).toMatchObject({
      status: 'rodando',
      apps: [{ repo: 'custom-api', port, url: `http://localhost:${port}`, status: 'rodando' }],
    })
    expect(JSON.parse(readFileSync(join(root, 'observed.json'), 'utf8'))).toEqual({
      directory: root,
      setting: 'fixture-value',
    })
    expect(readFileSync(join(card, '.dev-env/state.json'), 'utf8')).not.toContain('fixture-value')
  } finally {
    stopDevEnv(card)
  }
  expect(readDevEnv(card)?.status).toBe('parado')
}, 10_000)

test('killRunningApps derruba os outros apps e preserva quem falhou', () => {
  const killed: number[] = []
  const state: DevEnvInfo = {
    status: 'erro',
    apps: [
      { repo: 'api-garcom-digital', kind: 'backend', source: 'worktree', pid: 11, status: 'rodando' },
      { repo: 'operation-takeat', kind: 'frontend', source: 'worktree', pid: 22, status: 'erro' },
      { repo: 'manager-area', kind: 'frontend', source: 'master', status: 'aguardando' },
    ],
  }
  killRunningApps(state, (pid) => killed.push(pid))
  expect(killed).toEqual([11, 22])
  expect(state.apps.map((app) => app.status)).toEqual(['parado', 'erro', 'parado'])
  expect(state.apps.map((app) => app.pid)).toEqual([undefined, undefined, undefined])
  expect(state.apps[2].note).toBeUndefined()
})

function subindoState(ownerPid: number | undefined): string {
  const dir = mkdtempSync(join(tmpdir(), 'devenv-owner-'))
  mkdirSync(join(dir, '.dev-env'))
  const state: DevEnvInfo = { status: 'subindo', ownerPid, apps: [] }
  writeFileSync(join(dir, '.dev-env', 'state.json'), JSON.stringify(state))
  return dir
}

test('startup de outro processo vivo continua subindo', () => {
  const owner = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' })
  try {
    expect(readDevEnv(subindoState(owner.pid))?.status).toBe('subindo')
  } finally {
    owner.kill()
  }
})

test('startup sem dono vivo vira erro', async () => {
  const owner = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
  const pid = owner.pid as number
  await new Promise((resolve) => owner.on('exit', resolve))

  for (const dir of [subindoState(pid), subindoState(process.pid), subindoState(undefined)]) {
    const state = readDevEnv(dir)
    expect(state?.status).toBe('erro')
    expect(state?.error).toContain('Startup interrompido')
  }
})

test('finalização de tentativa antiga não remove uma nova tentativa do mesmo card', async () => {
  const card = cardWith([{ name: 'internal-dashboard', branch: 'ESTR-458' }])
  const aliasRoot = mkdtempSync(join(tmpdir(), 'devenv-alias-'))
  const cardAlias = join(aliasRoot, 'card')
  symlinkSync(card, cardAlias, process.platform === 'win32' ? 'junction' : 'dir')
  const frontend = join(card, 'internal-dashboard')
  const realFrontend = realpathSync(frontend)
  mkdirSync(join(realFrontend, 'node_modules'))
  writeFileSync(
    join(realFrontend, 'package.json'),
    JSON.stringify({ scripts: { dev: 'vite' }, packageManager: 'npm@10' }),
  )

  const children = new Set<ReturnType<typeof spawn>>()
  const runner: ProcessRunner = {
    execFileSync(command, args, options) {
      return execFileSync(command, [...args], options)
    },
    execFile(command, args, options, callback) {
      execFile(command, [...args], options, (error, stdout, stderr) =>
        callback(error, String(stdout ?? ''), String(stderr ?? '')),
      )
    },
    spawn(_command, _args, options) {
      const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], options ?? {})
      children.add(child)
      child.once('exit', () => children.delete(child))
      return child
    },
  }

  try {
    startDevEnv(card, undefined, runner)
    expect(readDevEnv(cardAlias)?.status).toBe('subindo')
    stopDevEnv(cardAlias)
    startDevEnv(card, undefined, runner)

    // The old waitPort loop notices the abort after its polling delay. Its
    // finally handler must not clear the replacement handle.
    await new Promise((resolve) => setTimeout(resolve, 1_800))
    expect(readDevEnv(cardAlias)?.status).toBe('subindo')
  } finally {
    stopDevEnv(card)
    for (const child of children) child.kill('SIGKILL')
  }
})
