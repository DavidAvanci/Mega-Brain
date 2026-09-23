import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { agentCwds, agentProcesses } from './agent-process'

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

  expect(agentProcesses(procRoot)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ pid: 100, interactive: false }),
      expect.objectContaining({ pid: 101, interactive: false }),
      expect.objectContaining({ pid: 102, interactive: true }),
      expect.objectContaining({ pid: 103, interactive: true }),
    ]),
  )
  expect(agentCwds(procRoot)).toEqual(new Set([terminal]))
})
