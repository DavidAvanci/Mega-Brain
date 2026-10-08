import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { agentCwds, agentProcesses, macAgentProcesses } from './agent-process'

test('chat print-mode processes are not mistaken for interactive terminal agents', () => {
  const root = mkdtempSync(join(tmpdir(), 'mega-brain-agent-process-'))
  const procRoot = join(root, 'proc')
  const card = join(root, 'card')
  const terminal = join(root, 'terminal')
  mkdirSync(card)
  mkdirSync(terminal)

  const process = (pid: number, cwd: string, argv: string[]) => {
    const dir = join(procRoot, String(pid))
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'cmdline'), argv.join('\0') + '\0')
    symlinkSync(cwd, join(dir, 'cwd'))
  }
  process(100, card, ['/usr/bin/claude', '-p', 'Mensagem do modal'])
  process(101, card, ['/usr/bin/codex', 'exec', '--json', 'Mensagem do modal'])
  process(102, terminal, ['/usr/bin/claude'])
  process(103, terminal, ['/usr/bin/codex'])
  process(104, terminal, ['/usr/bin/codex', 'app-server', '--listen', 'stdio://'])
  process(105, terminal, ['/usr/bin/node', '/usr/bin/codex', 'app-server'])

  expect(agentProcesses(procRoot)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ pid: 100, interactive: false }),
      expect.objectContaining({ pid: 101, interactive: false }),
      expect.objectContaining({ pid: 102, interactive: true }),
      expect.objectContaining({ pid: 103, interactive: true }),
    ]),
  )
  expect(agentCwds(procRoot)).toEqual(new Set([terminal]))
  expect(agentProcesses(procRoot).some(({ pid }) => pid === 104 || pid === 105)).toBe(false)
})

test('excludes Mac app-server helpers while retaining exec and resume sessions', () => {
  const commands: Record<string, string> = {
    '100': '/opt/codex app-server --listen stdio://',
    '101': '/opt/codex exec "Investigate codex app-server behavior"',
    '102': '/opt/codex resume session-id',
  }
  const run = (executable: string, args: readonly string[]): string => {
    if (executable.endsWith('lsof')) return 'p100\nfcwd\nn/project\n'
    if (args[0] === '-axo')
      return Object.keys(commands)
        .map((pid) => `${pid} /opt/codex`)
        .join('\n')
    const pid = args[args.indexOf('-p') + 1]
    return args[0] === 'eww' ? `${commands[pid]} HOME=/Users/person` : commands[pid]
  }
  expect(macAgentProcesses(run)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ pid: 101, interactive: false }),
      expect.objectContaining({ pid: 102, interactive: true }),
    ]),
  )
  expect(macAgentProcesses(run)).toHaveLength(2)
})

test('reads only Codex profile routing from process environments', () => {
  const root = mkdtempSync(join(tmpdir(), 'mega-brain-process-profile-'))
  const dir = join(root, 'proc', '100')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'cmdline'), '/opt/codex\0exec\0')
  writeFileSync(
    join(dir, 'environ'),
    `HOME=${root}\0CODEX_HOME=${root}/.codex-work\0MEGA_BRAIN_CODEX_PROFILE_ID=work\0API_KEY=credential-canary\0`,
  )
  symlinkSync(root, join(dir, 'cwd'))
  expect(agentProcesses(join(root, 'proc'))[0]).toMatchObject({
    codexHome: join(root, '.codex-work'),
    codexProfileId: 'work',
  })
  expect(JSON.stringify(agentProcesses(join(root, 'proc')))).not.toContain('credential-canary')
})

test('finds Mac profiles without treating command arguments or credentials as routing metadata', () => {
  const command = '/opt/codex exec "Do not trust CODEX_HOME=/spoofed"'
  const run = (executable: string, args: readonly string[]): string => {
    if (executable.endsWith('lsof')) return 'p100\nfcwd\nn/project\n'
    if (args[0] === '-axo') return '100 /opt/codex\n101 /Applications/other\n'
    if (args[0] === 'eww')
      return `${command} HOME=/Users/person CODEX_HOME=/Users/person/Codex profiles/work MEGA_BRAIN_CODEX_PROFILE_ID=work API_KEY=credential-canary`
    return command
  }
  const result = macAgentProcesses(run)
  expect(result).toEqual([
    {
      pid: 100,
      provider: 'codex',
      cwd: '/project',
      interactive: false,
      codexHome: '/Users/person/Codex profiles/work',
      codexProfileId: 'work',
    },
  ])
  expect(JSON.stringify(result)).not.toContain('credential-canary')
})
