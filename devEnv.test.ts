import { execFile, execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import type { DevEnvInfo } from './src/types'
import type { ProcessRunner } from './server/process'
import { classifyRepos, killRunningApps, planDevEnv, preferredPort, prepareDependencies, readDevEnv, shouldInstallDependencies, startDevEnv, stopDevEnv } from './devEnv'

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
  symlinkSync(join(canonical, 'node_modules'), join(worktree, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')

  expect(prepareDependencies(worktree, canonical)).toBe(true)
  expect(() => realpathSync(join(worktree, 'node_modules'))).toThrow()
})

function fakeRepo(root: string, name: string, branch: string): string {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  execFileSync('git', ['-C', dir, 'init', '-q', '-b', branch])
  execFileSync('git', ['-C', dir, 'commit', '-q', '--allow-empty', '-m', 'init'], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t',
    },
  })
  return dir
}

function cardWith(repos: { name: string; branch: string }[], linksDir = ''): string {
  const root = mkdtempSync(join(tmpdir(), 'devenv-'))
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
  const card = cardWith([{ name: 'api-garcom-digital', branch: 'ESTR-1' }, { name: 'operation-takeat', branch: 'ESTR-1' }], 'repos')
  expect(planDevEnv(card)).toMatchObject({
    localBackend: true,
    fronts: [{ repo: 'operation-takeat', source: 'worktree' }],
  })
})

test('planDevEnv: nada tocado é erro', () => {
  const card = cardWith([])
  expect(() => planDevEnv(card)).toThrow('Nenhum repo tocado')
})

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
  writeFileSync(join(realFrontend, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' }, packageManager: 'npm@10' }))

  const children = new Set<ReturnType<typeof spawn>>()
  const runner: ProcessRunner = {
    execFileSync(command, args, options) {
      return execFileSync(command, [...args], options)
    },
    execFile(command, args, options, callback) {
      execFile(command, [...args], options, (error, stdout, stderr) => callback(error, String(stdout ?? ''), String(stderr ?? '')))
    },
    spawn(_command, _args, options) {
      const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], options)
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
