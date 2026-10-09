import { EventEmitter } from 'node:events'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { ProcessChild, ProcessRunner } from '../process'
import { openBrowser, openTerminal } from './launchers'
import { createWorkspaceService } from './service'
import { workspaceHttp } from './http'
import { loadMegaBrainConfig } from '../config'

const applications = vi.hoisted(() => new Set<string>())
vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>()
  return {
    ...original,
    existsSync: (path: Parameters<typeof original.existsSync>[0]) => {
      const name = String(path)
      if (name.endsWith('.app')) return applications.has(name)
      return original.existsSync(path)
    },
  }
})

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!
const scripts: string[] = []
const roots: string[] = []
const defaultTerminal = '/System/Applications/Utilities/Terminal.app'

beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'darwin' })
  vi.stubEnv('WSL_DISTRO_NAME', undefined)
  applications.clear()
  applications.add(defaultTerminal)
})

afterEach(() => {
  Object.defineProperty(process, 'platform', originalPlatform)
  vi.unstubAllEnvs()
  vi.useRealTimers()
  for (const script of scripts.splice(0)) rmSync(dirname(script), { recursive: true, force: true })
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'mega-brain-launch-test-'))
  roots.push(root)
  return root
}

function recordingRunner(openFile?: (args: readonly string[]) => Error | null) {
  const calls: Array<{ command: string; args: readonly string[]; cwd?: string }> = []
  const runner: ProcessRunner = {
    execFileSync: () => {
      throw new Error('Unexpected synchronous process')
    },
    execFile(command, args, _options, callback) {
      calls.push({ command, args })
      if (args.at(-1)?.endsWith('.command')) scripts.push(args.at(-1)!)
      callback(openFile?.(args) ?? null, '', '')
    },
    spawn(command, args, options) {
      calls.push({ command, args, cwd: typeof options?.cwd === 'string' ? options.cwd : undefined })
      return Object.assign(new EventEmitter(), { unref() {} }) as unknown as ProcessChild
    },
  }
  return { runner, calls }
}

test('macOS opens Terminal by default with a private executable script in the card directory', async () => {
  const { runner, calls } = recordingRunner()
  await openTerminal('/cards/Meu card', ['/opt/bin/claude', '--resume', 'session-id'], undefined, runner)
  expect(calls).toEqual([{ command: '/usr/bin/open', args: ['-a', defaultTerminal, scripts[0]] }])
  const content = readFileSync(scripts[0], 'utf8')
  expect(content).toContain("cd '/cards/Meu card' || exit 1")
  expect(content).toContain("exec '/opt/bin/claude' '--resume' 'session-id'")
  expect(statSync(scripts[0]).mode & 0o777).toBe(0o700)
  expect(statSync(dirname(scripts[0])).mode & 0o777).toBe(0o700)
})

test.each(['iTerm', 'iTerm2', '/Applications/iTerm.app', '/Applications/iTerm.app/Contents/MacOS/iTerm2'])(
  'accepts the iTerm2 selection %s',
  async (selection) => {
    applications.add('/Applications/iTerm.app')
    const { runner, calls } = recordingRunner()
    await openTerminal('/cards/card', ['codex', 'resume', 'session-id'], selection, runner)
    expect(calls[0]).toMatchObject({ command: '/usr/bin/open', args: ['-a', '/Applications/iTerm.app', scripts[0]] })
  },
)

test('the generated script round-trips cwd and argv without executing prompt contents, then removes itself', async () => {
  const root = temporaryRoot()
  const card = join(root, "Card com espaço e ç ' $dollar `ticks`")
  mkdirSync(card)
  const output = join(root, 'result.json')
  const injectedFile = join(root, 'injected')
  const prompt = `Linha com "aspas", 'apóstrofo', $HOME, $(touch ${injectedFile}), \`touch ${injectedFile}\`\nSegunda linha; echo nope`
  const nodeScript =
    'require("node:fs").writeFileSync(process.argv[1], JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2),path:process.env.PATH}))'
  vi.stubEnv('PATH', `${root}/path with 'quotes':/usr/bin:/bin`)
  const { runner } = recordingRunner((args) => {
    const script = args.at(-1)!
    // Only the controlled fixture Node command runs; Launch Services and agents are fakes.
    execFileSync(script, [], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } })
    return null
  })
  await openTerminal(card, [process.execPath, '-e', nodeScript, output, prompt, '', '--flag'], undefined, runner)
  expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual({
    cwd: realpathSync(card),
    args: [prompt, '', '--flag'],
    path: `${process.env.PATH}:/usr/bin:/bin`,
  })
  expect(existsSync(injectedFile)).toBe(false)
  expect(existsSync(dirname(scripts[0]))).toBe(false)
})

test('launch failures reach the HTTP response and remove the script without leaking the prompt', async () => {
  const root = temporaryRoot()
  mkdirSync(join(root, 'card'))
  writeFileSync(join(root, 'card', 'card.json'), JSON.stringify({ status: 'code-review' }))
  const { runner } = recordingRunner(() => new Error('OS failure with a prompt canary'))
  const service = createWorkspaceService({ workspaceDir: root, executables: { claude: 'claude' } }, runner)
  const response = await workspaceHttp(service)({
    method: 'POST',
    path: '/dev-env/agent',
    query: new URLSearchParams(),
    headers: {},
    body: { name: 'card' },
  })
  expect(response).toMatchObject({
    status: 500,
    body: { error: 'Não foi possível abrir o terminal. Verifique o aplicativo configurado.' },
  })
  expect(existsSync(dirname(scripts[0]))).toBe(false)
  expect(JSON.stringify(response)).not.toContain('canary')
})

test('unused scripts expire even if the terminal accepted the file without running it', async () => {
  vi.useFakeTimers()
  const { runner } = recordingRunner()
  await openTerminal('/cards/card', ['claude'], undefined, runner)
  expect(existsSync(scripts[0])).toBe(true)
  vi.advanceTimersByTime(5 * 60_000)
  expect(existsSync(dirname(scripts[0]))).toBe(false)
})

test('missing Mac terminals and unsupported application bundles give platform-appropriate errors', async () => {
  applications.clear()
  const { runner, calls } = recordingRunner()
  await expect(openTerminal('/cards/card', ['claude'], undefined, runner)).rejects.toThrow(
    'Terminal do macOS não está disponível',
  )
  await expect(openTerminal('/cards/card', ['claude'], 'iTerm2', runner)).rejects.toThrow('iTerm2 não está disponível')
  await expect(openTerminal('/cards/card', ['claude'], '/Applications/Unknown.app', runner)).rejects.toThrow(
    'Use Terminal.app, iTerm.app',
  )
  expect(calls).toHaveLength(0)
})

test.each(['claude', 'chatgpt'] as const)('both terminal card actions support the %s provider', async (provider) => {
  const root = temporaryRoot()
  const config = loadMegaBrainConfig({ homeDir: root, env: { WORKSPACE_DIR: join(root, 'cards') } })
  mkdirSync(join(config.workspaceDir, 'card'), { recursive: true })
  writeFileSync(join(config.workspaceDir, 'card', 'card.json'), JSON.stringify({ status: 'code-review' }))
  writeFileSync(join(config.workspaceDir, 'card', 'agent.json'), JSON.stringify({ sessionId: 'recorded-session' }))
  config.preferences.llmProvider = provider
  config.preferences.terminalCommand = 'iTerm2'
  applications.add('/Applications/iTerm.app')
  config.executables.claude = '/fixture/claude'
  config.executables.codex = '/fixture/codex'
  config.preferences.prompts!.testEnvironment = 'Prepare o ambiente\ncom cuidado'
  const { runner, calls } = recordingRunner()
  const service = createWorkspaceService(config, runner)

  await expect(service.handle('/dev-env/agent', 'POST', new URLSearchParams(), { name: 'card' })).resolves.toEqual({
    ok: true,
  })
  expect(readFileSync(scripts[0], 'utf8')).toContain(
    provider === 'claude'
      ? "exec '/fixture/claude' '--model' 'haiku'"
      : "exec '/fixture/codex' '--dangerously-bypass-approvals-and-sandbox'",
  )
  expect(readFileSync(scripts[0], 'utf8')).toContain("'Prepare o ambiente\ncom cuidado'")
  expect(calls[0].args[1]).toBe('/Applications/iTerm.app')

  config.executables.terminal = 'Terminal'
  await expect(service.handle('/terminal', 'POST', new URLSearchParams(), { name: 'card' })).resolves.toEqual({
    ok: true,
  })
  expect(readFileSync(scripts[1], 'utf8')).toContain(
    provider === 'claude' ? "'--resume' 'recorded-session'" : "'resume' 'recorded-session'",
  )
  expect(calls[1].args[1]).toBe(defaultTerminal)
})

test('custom CLI terminals preserve direct argv and cwd', async () => {
  const executable = join(temporaryRoot(), 'terminal-fixture')
  writeFileSync(executable, '')
  const { runner, calls } = recordingRunner()
  await openTerminal('/cards/card with spaces', ['claude', 'multi\nline "prompt"'], executable, runner)
  expect(calls).toEqual([
    { command: executable, args: ['-e', 'claude', 'multi\nline "prompt"'], cwd: '/cards/card with spaces' },
  ])
})

test('a selected shell receives the agent arguments as positional data through the Mac terminal script', async () => {
  const { runner } = recordingRunner()
  await openTerminal('/cards/card', ['claude', 'multi\nline "prompt" $HOME'], undefined, runner, { shell: '/bin/sh' })
  const content = readFileSync(scripts[0], 'utf8')
  expect(content).toContain("exec '/bin/sh' '-lc' 'exec \"$@\"' 'mega-brain' 'claude' 'multi\nline \"prompt\" $HOME'")
  await expect(
    openTerminal('/cards/card', ['claude'], undefined, runner, { shell: '/missing-shell-fixture' }),
  ).rejects.toThrow('Shell não está disponível')
})

test('Mac card routes open the environment and pull requests in the default browser', async () => {
  const root = temporaryRoot()
  const card = join(root, 'card')
  mkdirSync(join(card, '.dev-env'), { recursive: true })
  writeFileSync(
    join(card, 'card.json'),
    JSON.stringify({
      status: 'code-review',
      prs: { staging: { api: 'https://github.test/api/pull/1', web: 'https://github.test/web/pull/2' } },
    }),
  )
  writeFileSync(
    join(card, '.dev-env', 'state.json'),
    JSON.stringify({ status: 'rodando', apps: [{ repo: 'web', status: 'rodando', url: 'http://localhost:5180' }] }),
  )
  const { runner, calls } = recordingRunner()
  const service = createWorkspaceService({ workspaceDir: root, executables: {} }, runner)
  await expect(
    service.handle('/dev-env/open', 'POST', new URLSearchParams(), { name: 'card', repo: 'web' }),
  ).resolves.toEqual({ ok: true })
  await expect(
    service.handle('/prs/open', 'POST', new URLSearchParams(), { name: 'card', env: 'staging' }),
  ).resolves.toEqual({ ok: true })
  expect(calls).toEqual([
    { command: '/usr/bin/open', args: ['http://localhost:5180'] },
    { command: '/usr/bin/open', args: ['https://github.test/api/pull/1', 'https://github.test/web/pull/2'] },
  ])
})

test('WSL targets its selected distribution and Linux retains the terminal executable contract', async () => {
  const executable = join(temporaryRoot(), 'terminal-fixture')
  writeFileSync(executable, '')
  Object.defineProperty(process, 'platform', { value: 'linux' })
  vi.stubEnv('WSL_DISTRO_NAME', 'Debian')
  const { runner, calls } = recordingRunner()
  await openTerminal('/home/user/Card com espaço', ['claude', '--resume', 'session'], executable, runner)
  expect(calls[0]).toEqual({
    command: executable,
    args: ['wsl.exe', '-d', 'Debian', '--cd', '/home/user/Card com espaço', '--', 'claude', '--resume', 'session'],
    cwd: undefined,
  })
  vi.stubEnv('WSL_DISTRO_NAME', undefined)
  await openTerminal('/cards/card', ['codex'], executable, runner)
  expect(calls[1]).toEqual({ command: executable, args: ['-e', 'codex'], cwd: '/cards/card' })
})

test('Mac browser launches use the default browser or a configured app, preserving every URL', async () => {
  const urls = ['http://localhost:5173', 'https://github.test/repo/pull/1?x=hello%20world&y=2']
  const { runner, calls } = recordingRunner()
  await openBrowser(urls, undefined, runner, { newWindow: true })
  applications.add('/Applications/Safari.app')
  await openBrowser(urls, '/Applications/Safari.app', runner)
  await openBrowser(urls, '/usr/bin/open', runner, { newWindow: true })
  expect(calls).toEqual([
    { command: '/usr/bin/open', args: urls },
    { command: '/usr/bin/open', args: ['-a', '/Applications/Safari.app', ...urls] },
    { command: '/usr/bin/open', args: urls },
  ])
})
