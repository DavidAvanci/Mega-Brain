import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { readTail, summarizeAgentInput } from './agent-log'

test('readTail returns the requested end of an agent transcript', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'mega-brain-agent-log-')), 'agent.jsonl')
  writeFileSync(file, 'primeiro\nsegundo\nterceiro')

  expect(readTail(file, 8)).toBe('terceiro')
  expect(readTail(file, 1024)).toBe('primeiro\nsegundo\nterceiro')
})

test('summarizeAgentInput selects the most useful supported field', () => {
  expect(summarizeAgentInput({ file_path: '/repo/app.ts', prompt: 'ignorado' })).toBe('/repo/app.ts')
  expect(summarizeAgentInput({ prompt: 'x'.repeat(200) })).toHaveLength(120)
})
